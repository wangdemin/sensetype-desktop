#include "api.h"

#if defined(SENSETYPE_KEYHOOK_MAC)

#import <ApplicationServices/ApplicationServices.h>
#include <atomic>
#include <thread>
#include <chrono>
#include <cstdlib>
#include <cstdio>

static CFMachPortRef g_tap = nullptr;
static CFRunLoopSourceRef g_source = nullptr;
static CFRunLoopRef g_runLoop = nullptr;
static std::atomic<bool> g_running(false);
// Startup guard:
// In some macOS environments (often around Accessibility permission changes / secure input),
// CGEventTapCreate may block for a long time. If JS times out and then joins the tap thread,
// it will hard-freeze the Electron main thread. Track "starting" and allow aborting without join.
static std::atomic<bool> g_starting(false);
static std::atomic<bool> g_abortStart(false);
// Start token: allow abandoning a blocked StartHook attempt without letting the old thread
// publish into globals once it finally returns.
static std::atomic<uint64_t> g_startToken(0);
static std::atomic<bool> g_altDown(false);
static std::atomic<bool> g_inCombo(false);
static std::atomic<bool> g_started(false);
static std::atomic<int> g_nonAltDownCount(0);
static std::atomic<bool> g_comboEver(false);
static std::atomic<uint64_t> g_altDownTick(0);
static std::atomic<uint32_t> g_delayMs(120);
static std::atomic<uint32_t> g_key(0); // 0=option,1=control,2=shift,3=command
static EventBridge* g_bridge = nullptr;
static std::atomic<uint64_t> g_seq(0);
static std::atomic<int> g_altKeycode(58);
static std::atomic<bool> g_suppressedDown(false);
static std::atomic<uint64_t> g_lastFlags(0);
// Fn+Space toggle-to-record (macOS):
// - First press+release: start recording (emit start on Space keyUp)
// - While active, next press: stop immediately (emit stop on Space keyDown)
// We swallow Space events while Fn is held to avoid triggering system emoji picker.
static std::atomic<bool> g_fnSpaceChord(false);
static std::atomic<bool> g_fnSpaceSuppressUp(false);
static std::atomic<bool> g_fnSpaceToggleActive(false);
static std::atomic<bool> g_comboEnabled(true);
// Track Fn state to make Fn+Space detection robust without false positives.
static std::atomic<bool> g_fnDownMaybe(false);
static std::atomic<uint64_t> g_lastFnSeenAt(0);

static bool DebugEnabled() {
  const char* v = std::getenv("SENSETYPE_KEYHOOK_DEBUG");
  return v && *v && *v != '0';
}

static bool SwallowEnabled() {
  // Always swallow the selected modifier for hold-to-record.
  // Rationale:
  // - Prevent browsers/apps from seeing Option/Alt and triggering shortcuts (DevTools/Inspector, etc).
  // - The "observe-only" mode caused too many hard-to-debug interference issues in real usage.
  return true;
}

static bool PollEnabled() {
  // Some macOS environments report modifier key state incorrectly via CGEventSourceKeyState,
  // which can cause false "released" detection and prevent long-press start.
  // We now default ON with debounce, because some environments miss "flagsChanged up" after
  // long holds or when the event tap gets disabled/re-enabled, causing recording to never stop.
  const char* v = std::getenv("SENSETYPE_KEYHOOK_POLL");
  // Explicit opt-out:
  if (v && *v == '0') return false;
  // Default OFF (opt-in only). With modifier-down not swallowed, flagsChanged up is reliable,
  // and some systems report keyState inconsistently under an event tap (can cause false stops).
  return v && *v && *v != '0';
}

static void DebugLog(const char* msg) {
  if (!DebugEnabled()) return;
  std::fprintf(stderr, "[sensetype-keyhook:mac] %s\n", msg);
  std::fflush(stderr);
}

// 打印一次常量值
static void LogConstantsOnce() {
  static std::atomic<bool> logged(false);
  if (!logged.exchange(true) && DebugEnabled()) {
    char buf[128];
    std::snprintf(buf, sizeof(buf), "CONST: SecondaryFn=0x%llx", (unsigned long long)kCGEventFlagMaskSecondaryFn);
    DebugLog(buf);
  }
}

static std::thread g_thread;
static std::thread g_pollThread;
static std::atomic<bool> g_polling(false);
static std::thread g_releaseThread;
static std::atomic<bool> g_releasePolling(false);
// Watchdog: some macOS environments may disable the event tap without reliably delivering
// kCGEventTapDisabledByTimeout/UserInput callbacks (e.g. long background, secure input transitions).
// We periodically verify CGEventTapIsEnabled and re-enable it from the tap's runloop thread.
static std::thread g_tapWatchdogThread;
static std::atomic<bool> g_tapWatchdogRunning(false);
static std::atomic<uint64_t> g_lastTapReEnableAt(0);
static std::atomic<int> g_ready(0); // 0=unknown, 1=ready, -1=failed

static CGEventFlags HoldMask() {
  const uint32_t k = g_key.load();
  if (k == 1) return kCGEventFlagMaskControl;
  if (k == 2) return kCGEventFlagMaskShift;
  if (k == 3) return kCGEventFlagMaskCommand;
  return kCGEventFlagMaskAlternate; // option
}

static void HoldKeycodes(CGKeyCode& left, CGKeyCode& right) {
  const uint32_t k = g_key.load();
  // left/right modifier virtual keycodes on mac:
  // option: 58/61, control: 59/62, shift: 56/60, command: 55/54
  if (k == 1) {
    left = (CGKeyCode)59;
    right = (CGKeyCode)62;
    return;
  }
  if (k == 2) {
    left = (CGKeyCode)56;
    right = (CGKeyCode)60;
    return;
  }
  if (k == 3) {
    left = (CGKeyCode)55;
    right = (CGKeyCode)54;
    return;
  }
  left = (CGKeyCode)58;
  right = (CGKeyCode)61;
}

static int DefaultHoldKeycode() {
  CGKeyCode l = 58, r = 61;
  HoldKeycodes(l, r);
  return (int)l;
}

static bool IsAltKey(CGKeyCode keycode) {
  CGKeyCode l = 58, r = 61;
  HoldKeycodes(l, r);
  return keycode == l || keycode == r;
}

static bool HasOtherModifiers(CGEventFlags flags) {
  const CGEventFlags allMask =
      (kCGEventFlagMaskShift | kCGEventFlagMaskControl | kCGEventFlagMaskCommand |
       kCGEventFlagMaskAlternate);
  const CGEventFlags selected = HoldMask();
  const CGEventFlags othersMask = (allMask & ~selected);
  // NOTE:
  // Some environments can report "stuck" modifiers via CGEventSourceFlagsState (e.g. after synthetic
  // key sequences), which causes false combo detection and leads to not swallowing the hold key.
  // That can leak Option into browsers and trigger DevTools shortcuts.
  //
  // Therefore this helper uses ONLY the current event's flags.
  return (flags & othersMask) != 0;
}

static uint64_t NowMs() {
  return (uint64_t)(CFAbsoluteTimeGetCurrent() * 1000.0);
}

// Forward declarations (used by watchdog; definitions are below).
static void EnsureReleaseThread(uint64_t seq);

static void EnsureTapWatchdog(uint64_t seq) {
  if (g_tapWatchdogRunning.load()) return;
  if (g_tapWatchdogThread.joinable()) {
    g_tapWatchdogThread.join();
  }
  g_tapWatchdogRunning.store(true);
  g_tapWatchdogThread = std::thread([seq]() {
    while (g_running.load() && g_seq.load() == seq) {
      std::this_thread::sleep_for(std::chrono::milliseconds(1000));
      if (!g_running.load() || g_seq.load() != seq) break;
      if (!g_tap || !g_runLoop) continue;
      // If the tap is disabled, re-enable from the runloop thread.
      if (!CGEventTapIsEnabled(g_tap)) {
        const uint64_t now = NowMs();
        const uint64_t last = g_lastTapReEnableAt.load();
        // avoid tight loops
        if (now > last && (now - last) < 600) continue;
        g_lastTapReEnableAt.store(now);
        DebugLog("watchdog: CGEventTapIsEnabled=false, scheduling re-enable...");
        // Ensure operations happen on the tap thread runloop.
        CFRunLoopRef rl = g_runLoop;
        CFRetain(rl);
        CFRunLoopPerformBlock(rl, kCFRunLoopCommonModes, ^{
          if (g_tap) {
            CGEventTapEnable(g_tap, false);
            CGEventTapEnable(g_tap, true);
          }
          // If the tap was disabled while holding, we may miss the "up" flagsChanged.
          if (g_altDown.load()) {
            EnsureReleaseThread(g_seq.load());
          }
        });
        CFRunLoopWakeUp(rl);
        CFRelease(rl);
      }
    }
    g_tapWatchdogRunning.store(false);
  });
}

static bool IsHoldDownByKeyState() {
  CGKeyCode l = 58, r = 61;
  HoldKeycodes(l, r);
  const bool hidLeft =
      CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, (CGKeyCode)l);
  const bool hidRight =
      CGEventSourceKeyState(kCGEventSourceStateHIDSystemState, (CGKeyCode)r);
  const bool sessLeft =
      CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, (CGKeyCode)l);
  const bool sessRight =
      CGEventSourceKeyState(kCGEventSourceStateCombinedSessionState, (CGKeyCode)r);
  return hidLeft || hidRight || sessLeft || sessRight;
}

static bool IsHoldDownByFlagsState() {
  const CGEventFlags flagsNow =
      CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState);
  return (flagsNow & HoldMask()) != 0;
}

static void EnsureReleaseThread(uint64_t seq) {
  // Only needed as a safety net when the event tap gets disabled while holding.
  if (g_releasePolling.load()) return;
  if (g_releaseThread.joinable()) {
    g_releaseThread.join();
  }
  g_releasePolling.store(true);
  g_releaseThread = std::thread([seq]() {
    int upStreak = 0;
    while (g_running.load() && g_seq.load() == seq) {
      std::this_thread::sleep_for(std::chrono::milliseconds(16));
      if (!g_altDown.load()) break;

      const bool downByFlags = IsHoldDownByFlagsState();
      if (downByFlags) {
        upStreak = 0;
        continue;
      }
      upStreak++;
      if (upStreak < 3) continue;

      DebugLog("release-watch: hold released (tap disabled / missed up), emitting stop/cancel");
      const bool started = g_started.load();
      const bool comboEver = g_comboEver.load();
      const bool inCombo = g_inCombo.load();
      const int nonAltDown = (int)g_nonAltDownCount.load();
      const bool hasOtherMods =
          HasOtherModifiers(CGEventSourceFlagsState(kCGEventSourceStateCombinedSessionState));

      if (started && g_bridge) {
        if (comboEver || inCombo || (nonAltDown > 0) || hasOtherMods) {
          g_bridge->EmitCancel();
        } else {
          g_bridge->EmitStop();
        }
      }

      g_altDown.store(false);
      g_started.store(false);
      g_inCombo.store(false);
      g_suppressedDown.store(false);
      g_comboEver.store(false);
      break;
    }
    g_releasePolling.store(false);
  });
}

static void EnsurePollThread(uint64_t seq) {
  if (!PollEnabled()) return;
  if (g_polling.load()) return;
  // Important: std::thread remains joinable even after it has finished executing.
  // If we overwrite a joinable thread object, its destructor will call std::terminate().
  // This can happen when Option is pressed again after a previous poll thread ended.
  if (g_pollThread.joinable()) {
    // NOTE: exceptions are disabled for this addon; avoid try/catch here.
    // We only join when joinable and EnsurePollThread is called from the tap thread,
    // so this should be safe.
    g_pollThread.join();
  }
  g_polling.store(true);
  g_pollThread = std::thread([seq]() {
    int notDownStreak = 0;
    // Poll until Option is released or hook stopped.
    while (g_running.load() && g_seq.load() == seq) {
      std::this_thread::sleep_for(std::chrono::milliseconds(8));
      if (!g_altDown.load()) {
        // no longer tracking an Option hold
        break;
      }
      // Guard: right after flagsChanged "down", key state queries may temporarily
      // report false. Avoid immediately treating it as released.
      const uint64_t downTick = g_altDownTick.load();
      const uint64_t now = NowMs();
      if (now >= downTick && (now - downTick) < 60) {
        continue;
      }

      // Primary signal: last observed event flags. If we recently saw holdMask in event flags,
      // do NOT treat key state false as release (some systems misreport key state while we swallow).
      const uint64_t lastFlags = g_lastFlags.load();
      const bool downByFlags = ((CGEventFlags)lastFlags & HoldMask()) != 0;
      const bool downBySystemFlags = IsHoldDownByFlagsState();
      const bool downByKeyState = IsHoldDownByKeyState();

      if (downByFlags) {
        // If the system flags still report the modifier as down, we are definitely still holding.
        // Some machines report CGEventSourceKeyState=false even while holding under an event tap.
        if (downBySystemFlags) {
          notDownStreak = 0;
          continue;
        }
        // Only if system flags AND key state are continuously "up" for a while do we assume we missed the up event.
        if (!downByKeyState && !downBySystemFlags) {
          notDownStreak++;
        } else {
          notDownStreak = 0;
        }
        // Stronger debounce: require ~250ms of consistent "up" readings
        if (notDownStreak < 32) {
          continue;
        }
        DebugLog("poll: assume hold released (missing up) after sustained keyState up");
      } else {
        // Flags already say up (likely we received flagsChanged up): allow stop, but debounce a little.
        if (!downByKeyState && !downBySystemFlags) {
          notDownStreak++;
        } else {
          notDownStreak = 0;
        }
        if (notDownStreak < 3) continue;
        DebugLog("poll: hold up (flags cleared, debounced)");
      }

        // Treat as Option up even if we didn't receive flagsChanged up (may happen when swallowing down).
        const bool inCombo = g_inCombo.load();
        const bool suppressedDown = g_suppressedDown.load();
        const bool started = g_started.load();
        if (!inCombo && suppressedDown) {
          if (started && g_bridge) {
            DebugLog("poll: emit stop");
            g_bridge->EmitStop();
          }
        }
        g_altDown.store(false);
        g_started.store(false);
        g_inCombo.store(false);
        g_suppressedDown.store(false);
        break;
    }
    g_polling.store(false);
  });
}

static CGEventRef TapCallback(CGEventTapProxy, CGEventType type, CGEventRef event, void*) {
  // 如果 tap 被系统禁用，尝试恢复
  // 某些应用（如 Figma）可能会禁用 Event Tap，需要立即恢复
  if (type == kCGEventTapDisabledByTimeout || type == kCGEventTapDisabledByUserInput) {
    DebugLog("Event tap disabled, attempting to re-enable...");
    if (g_tap) {
      // 先禁用再启用，确保状态重置
      CGEventTapEnable(g_tap, false);
      CGEventTapEnable(g_tap, true);
      DebugLog("Event tap re-enabled");
    }
    // If the tap gets disabled mid-hold, we may miss keyUp events for non-Alt keys.
    // That can leave g_nonAltDownCount stuck >0 and cause subsequent holds to be misdetected as combos.
    // Also cancel any pending start to avoid false triggers while the tap is unstable.
    g_seq.fetch_add(1);
    g_inCombo.store(true);
    g_comboEver.store(true);
    // If the tap was disabled while holding, we may miss the "up" flagsChanged.
    // Start a lightweight watcher to emit stop/cancel once the modifier is actually released.
    if (g_altDown.load()) {
      EnsureReleaseThread(g_seq.load());
    }
    return event;
  }

  if (type != kCGEventKeyDown && type != kCGEventKeyUp && type != kCGEventFlagsChanged &&
      type != kCGEventLeftMouseDown && type != kCGEventLeftMouseUp &&
      type != kCGEventRightMouseDown && type != kCGEventRightMouseUp &&
      type != kCGEventOtherMouseDown && type != kCGEventOtherMouseUp &&
      type != kCGEventMouseMoved && type != kCGEventLeftMouseDragged &&
      type != kCGEventRightMouseDragged && type != kCGEventOtherMouseDragged &&
      type != kCGEventScrollWheel) {
    return event;
  }

  // Ignore events injected by this addon (avoid self-interference with sendText()).
  // IMPORTANT:
  // Some macOS versions do not reliably report kCGEventSourceStatePrivate via kCGEventSourceStateID
  // for CGEventPost() events. Therefore we tag our injected events with kCGEventSourceUserData
  // and ignore them here to prevent injected text from breaking hold-to-record state.
  // Tag values in kCGEventSourceUserData so the tap can treat our injected events differently.
  // - Text events must have flags cleared (avoid shortcuts while user holds Option).
  // - Shortcut events (Cmd+C/V) must preserve Cmd flag; otherwise copy/paste becomes plain 'c'/'v'.
  static const int64_t kSensetypeInjectedTextMagic = 0x53454E5345545950LL; // "SENSETYP"
  static const int64_t kSensetypeInjectedComboMagic = 0x53454E5345545943LL; // "SENSETYC"
  const int64_t userData = CGEventGetIntegerValueField(event, kCGEventSourceUserData);
  if (userData == kSensetypeInjectedTextMagic) {
    // Also forcibly clear modifier flags so injected unicode won't be interpreted as shortcuts
    // when the user is physically holding a modifier (e.g. Option during hold-to-record).
    CGEventSetFlags(event, 0);
    return event;
  }
  if (userData == kSensetypeInjectedComboMagic) {
    // Let Cmd+C/V pass through with its Cmd flag intact.
    return event;
  }
  // While holding the hotkey modifier, scrub it from ALL mouse events.
  // Browsers/devtools can infer modifier state from mouse events (not just flagsChanged),
  // leading to "inspect element"/console/focus loss behavior even if we swallowed the key event.
  if ((type == kCGEventLeftMouseDown || type == kCGEventLeftMouseUp ||
       type == kCGEventRightMouseDown || type == kCGEventRightMouseUp ||
       type == kCGEventOtherMouseDown || type == kCGEventOtherMouseUp ||
       type == kCGEventMouseMoved || type == kCGEventLeftMouseDragged ||
       type == kCGEventRightMouseDragged || type == kCGEventOtherMouseDragged ||
       type == kCGEventScrollWheel) &&
      g_altDown.load() && g_suppressedDown.load()) {
    CGEventFlags f = CGEventGetFlags(event);
    CGEventSetFlags(event, (CGEventFlags)(f & ~HoldMask()));
    return event;
  }
  // Fallback: try to ignore private-source events as well.
  const int64_t sourceState = CGEventGetIntegerValueField(event, kCGEventSourceStateID);
  if (sourceState == (int64_t)kCGEventSourceStatePrivate) {
    return event;
  }

  // Modifier key changes usually come as kCGEventFlagsChanged.
  // Some environments may provide unexpected keycode on flagsChanged, so we rely on flag transition.
  CGEventFlags flags = CGEventGetFlags(event);
  g_lastFlags.store((uint64_t)flags);
  const CGEventFlags holdMask = HoldMask();
  bool optionDownNow = (flags & holdMask) != 0;

  CGKeyCode keycode = (CGKeyCode)CGEventGetIntegerValueField(event, kCGKeyboardEventKeycode);

  if (DebugEnabled()) {
    // 调试：只打印键盘相关事件，避免鼠标移动/滚轮刷屏
    if (type == kCGEventKeyDown || type == kCGEventKeyUp || type == kCGEventFlagsChanged) {
      char buf[256];
      std::snprintf(buf, sizeof(buf), "DEBUG: type=%d keycode=%d flags=0x%llx",
                    (int)type, (int)keycode, (unsigned long long)flags);
      DebugLog(buf);
    }
  }

  // ===== Fn+Space toggle-to-record =====
  // Space keycode on macOS is 49. Fn is represented in CGEventFlags as kCGEventFlagMaskSecondaryFn.
  // IMPORTANT: handle this BEFORE hold-to-record logic so we can reliably swallow Fn+Space.
  if (g_comboEnabled.load() && (type == kCGEventKeyDown || type == kCGEventKeyUp)) {
    // 拦截 Fn 键引发的 179 号键事件（通常是 Globe Key / Emoji Picker 的触发源）。
    // 经测试，Fn 按下/松开时会伴随 keycode 179 的 Down/Up，如果放行这个 179，系统会弹出表情窗口。
    if (keycode == 179) {
      // Treat as a strong signal that Fn is involved, but avoid relying on session flags state
      // (can be "stuck" and cause false Fn+Space triggers).
      g_lastFnSeenAt.store(NowMs());
      if (type == kCGEventKeyDown) g_fnDownMaybe.store(true);
      if (type == kCGEventKeyUp) g_fnDownMaybe.store(false);
      DebugLog("Intercepted special key 179 (Globe/Emoji) triggered by Fn");
      return nullptr;
    }

    if (keycode == (CGKeyCode)49) {
      // IMPORTANT:
      // Do NOT consult current session flags state here. It can occasionally report SecondaryFn
      // even when Fn isn't physically pressed, causing space-alone to be misdetected as Fn+Space.
      const bool fnFlag = (flags & kCGEventFlagMaskSecondaryFn) != 0;
      const uint64_t now = NowMs();
      const bool fnRecent = g_fnDownMaybe.load() && (now - g_lastFnSeenAt.load() < 250);
      const bool fnDown = fnFlag || fnRecent;
      const int64_t autorepeat =
          CGEventGetIntegerValueField(event, kCGKeyboardEventAutorepeat);
      const bool isRepeat = autorepeat != 0;

      if (type == kCGEventKeyDown) {
        // Only consider Fn+Space on the initial keydown (ignore auto-repeat).
        if (fnDown) {
          if (!isRepeat) {
            g_fnSpaceChord.store(true);
            if (g_fnSpaceToggleActive.load()) {
              // Second press: stop immediately.
              g_fnSpaceSuppressUp.store(true);
              g_fnSpaceToggleActive.store(false);
              if (g_bridge) {
                // UI feedback: space is pressed
                g_bridge->Emit("keydown", "space");
                g_bridge->EmitStop();
              }
            } else {
              // First press: start on keyUp.
              // UI feedback: space is pressed
              if (g_bridge) g_bridge->Emit("keydown", "space");
              g_fnSpaceSuppressUp.store(false);
            }
          }
          return nullptr; // swallow to avoid emoji picker / space input
        }
      } else { // keyUp
        // If we saw a Fn+Space chord on keydown, always swallow the keyUp too.
        if (g_fnSpaceChord.load()) {
          const bool suppressUp = g_fnSpaceSuppressUp.load();
          g_fnSpaceChord.store(false);
          g_fnSpaceSuppressUp.store(false);
          
          // UI feedback: space is released
          if (g_bridge) g_bridge->Emit("keyup", "space");

          if (!suppressUp) {
            // First press released: start recording.
            if (!g_fnSpaceToggleActive.load()) {
              g_fnSpaceToggleActive.store(true);
              if (g_bridge) g_bridge->EmitStart();
            }
          }
          return nullptr;
        }
      }
    }
  }

  if (type == kCGEventFlagsChanged) {
    const bool optionDownPrev = g_altDown.load();
    
    // 特殊处理 Fn 键 (keycode 63)：
    // 1. 发送 keydown/keyup 事件给前端（用于点亮 UI）
    // 2. 吞掉事件（拦截系统表情窗口）
    if (g_comboEnabled.load() && keycode == 63) {
      const bool fnDown = (flags & kCGEventFlagMaskSecondaryFn) != 0;
      g_lastFnSeenAt.store(NowMs());
      g_fnDownMaybe.store(fnDown);
      if (fnDown) {
         if (g_bridge) g_bridge->Emit("keydown", "fn");
      } else {
         if (g_bridge) g_bridge->Emit("keyup", "fn");
      }
      // 拦截 macOS 表情选择器 (通常在 Fn 松开时触发)。
      // 注意：如果用户配置了 Fn 作为 hold-to-record 键（虽然目前代码逻辑不支持配置 Fn），
      // 这里吞掉会导致 hold 逻辑失效。但鉴于当前只支持 Option/Alt 等，这里拦截是安全的。
      return nullptr;
    }

    if (DebugEnabled()) {
      char buf0[220];
      std::snprintf(
          buf0,
          sizeof(buf0),
          "flagsChanged: keycode=%d flags=0x%llx holdMask=0x%llx holdNow=%d holdPrev=%d keySel=%u",
          (int)keycode,
          (unsigned long long)flags,
          (unsigned long long)holdMask,
          optionDownNow ? 1 : 0,
          optionDownPrev ? 1 : 0,
          (unsigned)g_key.load());
      DebugLog(buf0);
    }

    // Try to keep track of which modifier key was involved (if provided).
    if (IsAltKey(keycode)) {
      g_altKeycode.store((int)keycode);
    }

    // If hold modifier is down AND any other modifier is down, this is a combo.
    // Never trigger voice in combos; if recording already started, cancel immediately.
    if (optionDownNow && g_altDown.load() && HasOtherModifiers(flags)) {
      g_comboEver.store(true);
      if (!g_inCombo.exchange(true)) {
        DebugLog("flagsChanged: combo detected (other modifier down)");
        // IMPORTANT:
        // When the selected modifier is used as hold-to-record hotkey, we MUST NOT re-inject it
        // for combos, otherwise browsers may receive Option and trigger DevTools/Inspector shortcuts.
        // Therefore we keep swallowing the modifier even if a combo is detected.
        // cancel pending start
        g_seq.fetch_add(1);
        // Safety net: in some macOS transitions, we may miss the "hold up" flagsChanged even for combos.
        // Start a lightweight watcher so we always clear internal state once the modifier is released.
        EnsureReleaseThread(g_seq.load());
        if (g_started.load()) {
          DebugLog("flagsChanged: emit cancel");
          if (g_bridge) g_bridge->EmitCancel();
          g_started.store(false);
        }
      }
      return event;
    }

    // Transition: up -> down
    if (optionDownNow && !optionDownPrev) {
      DebugLog("flagsChanged: hold modifier down");
      g_altDown.store(true);
      // Self-heal:
      // In some macOS transitions (app switch / secure input / event-tap disable/reenable),
      // we may miss keyUp for non-modifier keys, leaving g_nonAltDownCount stuck > 0.
      // That would cause the next "hold modifier" press to be treated as a combo and never start voice,
      // so users have to press the hotkey multiple times.
      //
      // Trade-off: if the user is truly holding another key down while pressing the modifier,
      // clearing this counter may allow a false "single-key hold" start. In practice this is rare,
      // and subsequent real keyDown events still cancel pending start immediately.
      if (g_nonAltDownCount.load() > 0) {
        DebugLog("flagsChanged: clearing stuck nonAltDownCount on hold down");
        g_nonAltDownCount.store(0);
      }
      // 如果此时已经有其它键按下，或同时按着其它修饰键，判定为组合键，不触发语音
      const bool inComboOnDown = (g_nonAltDownCount.load() > 0) || HasOtherModifiers(flags);
      g_inCombo.store(inComboOnDown);
      g_comboEver.store(inComboOnDown);
      g_started.store(false);
      g_altDownTick.store(NowMs());

      // Best-effort self-heal:
      // If some other modifier got "stuck" at the OS level (common after synthetic Cmd+V),
      // pressing the hold modifier in apps like browsers can trigger shortcuts (e.g. Opt+Cmd+I/J),
      // stealing focus and opening DevTools/Console.
      //
      // We only do this on the single-hold path (NOT combos), and we never release the selected hold key.
      if (!inComboOnDown) {
        static const int64_t kSensetypeInjectedTextMagic = 0x53454E5345545950LL; // "SENSETYP"
        const uint32_t sel = g_key.load(); // 0=option,1=control,2=shift,3=command
        auto postKeyUp = [&](CGKeyCode code) {
          CGEventRef up = CGEventCreateKeyboardEvent(nullptr, code, false);
          if (!up) return;
          CGEventSetFlags(up, 0);
          CGEventSetIntegerValueField(up, kCGEventSourceUserData, kSensetypeInjectedTextMagic);
          CGEventPost(kCGHIDEventTap, up);
          CFRelease(up);
        };
        if (sel != 3) { // command
          postKeyUp((CGKeyCode)55);
          postKeyUp((CGKeyCode)54);
        }
        if (sel != 1) { // control
          postKeyUp((CGKeyCode)59);
          postKeyUp((CGKeyCode)62);
        }
        if (sel != 2) { // shift
          postKeyUp((CGKeyCode)56);
          postKeyUp((CGKeyCode)60);
        }
        if (sel != 0) { // option
          postKeyUp((CGKeyCode)58);
          postKeyUp((CGKeyCode)61);
        }
      }

      // Swallow modifier-down ONLY for the single-key hold case so apps don't receive Option/Alt.
      // If we later detect a combo (Option+Key), we will re-inject the modifier-down so the combo works.
      // IMPORTANT:
      // Always swallow the selected modifier while using hold-to-record, even if a combo is detected.
      // This prevents Option leakage into browsers (Option+Click / Option+Cmd+...).
      const bool swallowOnDown = SwallowEnabled();
      g_suppressedDown.store(swallowOnDown);
      const uint64_t seq = g_seq.fetch_add(1) + 1;
      EnsurePollThread(seq);

      if (!inComboOnDown) {
        std::thread([seq]() {
          std::this_thread::sleep_for(std::chrono::milliseconds(g_delayMs.load()));
          if (g_seq.load() != seq) return;
          if (!g_altDown.load()) return;
          // 更宽松的组合键检测：主要依赖实际按键事件（g_nonAltDownCount），
          // 而不是修饰键状态，避免与 Figma 等应用的快捷键冲突
          // 如果已经有其他键按下，则判定为组合键
          if (g_nonAltDownCount.load() > 0) {
            g_inCombo.store(true);
            return;
          }
          // 如果已经被标记为组合键，则不启动
          if (g_inCombo.load()) return;
          if (g_started.load()) return;
          g_started.store(true);
          DebugLog("delay: emit start");
          if (g_bridge) g_bridge->EmitStart();
        }).detach();
      }

      if (swallowOnDown) return nullptr;
      return event;
    }

    // Transition: down -> up
    if (!optionDownNow && optionDownPrev) {
      DebugLog("flagsChanged: hold modifier up");
      const bool suppressedDown = g_suppressedDown.load();
      const bool started = g_started.load();
      const bool comboEver = g_comboEver.load();
      const bool inCombo = g_inCombo.load();
      const int nonAltDown = (int)g_nonAltDownCount.load();
      const bool hasOtherMods = HasOtherModifiers(flags);

      // 强制输出状态（用于排查）
      char buf[200];
      std::snprintf(
          buf,
          sizeof(buf),
          "hold up: started=%d comboEver=%d inCombo=%d suppressedDown=%d nonAltDown=%d hasOtherMods=%d bridge=%p",
          started ? 1 : 0,
          comboEver ? 1 : 0,
          inCombo ? 1 : 0,
          suppressedDown ? 1 : 0,
          nonAltDown,
          hasOtherMods ? 1 : 0,
          (void*)g_bridge);
      DebugLog(buf);

      // 规则：只要录音已开始，松开 Option 必然 stop 或 cancel（不依赖 suppressedDown）
      if (started) {
        if (g_bridge) {
          if (comboEver || inCombo || (nonAltDown > 0) || hasOtherMods) {
            DebugLog("flagsChanged: emit cancel (on option up)");
            g_bridge->EmitCancel();
          } else {
            DebugLog("flagsChanged: emit stop");
            g_bridge->EmitStop();
          }
        } else {
          DebugLog("WARNING: started=true but g_bridge is null!");
        }
      } else {
        DebugLog("hold up: started=false, skipping stop/cancel");
      }

      g_altDown.store(false);
      g_started.store(false);
      g_inCombo.store(false);
      g_suppressedDown.store(false);
      g_comboEver.store(false);
      // Reset non-Alt key count on modifier release.
      // Some macOS transitions (app switch, secure input, tap disable/reenable) may cause missed keyUp,
      // leaving the counter stuck and breaking future "single-key hold" detection.
      g_nonAltDownCount.store(0);

      // 只要 down 被吞掉，就必须吞掉 up（不然外部应用会收到一个“孤儿 up”，仍可能触发奇怪行为/快捷键状态）。
      if (suppressedDown) {
        return nullptr;
      }
      return event;
    }

    // No option transition: leave it
    return event;
  }

  if (type == kCGEventKeyDown) {
    if (!IsAltKey(keycode)) {
      g_nonAltDownCount.fetch_add(1);
      // 如果 hold modifier 已按下，此时出现第二个键：立即判定组合键，取消语音
      if (g_altDown.load()) {
        // Do NOT re-inject the modifier for combos (see comment above).
        g_inCombo.store(true);
        g_comboEver.store(true);
        // 取消 pending start
        g_seq.fetch_add(1);
        // Safety net: some combos (e.g., input source switching) may lead to missing flagsChanged up.
        // Start watcher so the next single hold doesn't get stuck in combo state.
        EnsureReleaseThread(g_seq.load());
        // 如果已经进入录音态，立刻 cancel（不走识别/重写）
        const bool wasStarted = g_started.exchange(false);
        if (wasStarted && g_bridge) {
          DebugLog("combo: emit cancel");
          g_bridge->EmitCancel();
        }
      }
    }
    if (g_altDown.load() && !IsAltKey(keycode)) {
      g_inCombo.store(true);
      // Do NOT synthesize modifier-down for combos (prevents Option leakage into target apps).
    }
    return event;
  }

  if (type == kCGEventKeyUp) {
    if (!IsAltKey(keycode)) {
      int cur = g_nonAltDownCount.load();
      if (cur > 0) g_nonAltDownCount.store(cur - 1);
    }
    return event;
  }

  // 默认放行
  return event;
}

bool SendTextToActiveApp(const std::u16string& text) {
  if (text.empty()) return true;

  // Create a private event source so our own event tap can ignore these events.
  CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStatePrivate);
  if (!src) return false;
  // Best-effort: do not inherit any modifier flags.
  CGEventSourceSetLocalEventsSuppressionInterval(src, 0.0);

  // If the system thinks other modifiers are held (e.g. from a stuck Cmd after a paste simulation),
  // unicode injection may trigger app shortcuts (e.g. Cmd+Opt+I opens DevTools) instead of inserting text.
  // Best-effort: release non-selected modifiers before injecting text.
  // NOTE: do NOT release the configured hold-to-record modifier (g_key), otherwise we may stop recording.
  {
    static const int64_t kSensetypeInjectedTextMagic = 0x53454E5345545950LL; // "SENSETYP"
    const uint32_t sel = g_key.load();
    auto postKeyUp = [&](CGKeyCode code) {
      CGEventRef up = CGEventCreateKeyboardEvent(src, code, false);
      if (!up) return;
      CGEventSetFlags(up, 0);
      CGEventSetIntegerValueField(up, kCGEventSourceUserData, kSensetypeInjectedTextMagic);
      CGEventPost(kCGHIDEventTap, up);
      CFRelease(up);
    };
    // 0=option, 1=control, 2=shift, 3=command
    if (sel != 3) { // command
      postKeyUp((CGKeyCode)55);
      postKeyUp((CGKeyCode)54);
    }
    if (sel != 1) { // control
      postKeyUp((CGKeyCode)59);
      postKeyUp((CGKeyCode)62);
    }
    if (sel != 2) { // shift
      postKeyUp((CGKeyCode)56);
      postKeyUp((CGKeyCode)60);
    }
    if (sel != 0) { // option
      postKeyUp((CGKeyCode)58);
      postKeyUp((CGKeyCode)61);
    }
  }

  bool ok = true;
  for (size_t i = 0; i < text.size(); i++) {
    UniChar ch = (UniChar)text[i];
    // keyDown
    CGEventRef down = CGEventCreateKeyboardEvent(src, (CGKeyCode)0, true);
    CGEventRef up = CGEventCreateKeyboardEvent(src, (CGKeyCode)0, false);
    if (!down || !up) {
      if (down) CFRelease(down);
      if (up) CFRelease(up);
      ok = false;
      break;
    }
    CGEventSetFlags(down, 0);
    CGEventSetFlags(up, 0);
    // Tag injected events so our event tap can ignore them (prevents hold-to-record cancellation).
    static const int64_t kSensetypeInjectedTextMagic = 0x53454E5345545950LL; // "SENSETYP"
    CGEventSetIntegerValueField(down, kCGEventSourceUserData, kSensetypeInjectedTextMagic);
    CGEventSetIntegerValueField(up, kCGEventSourceUserData, kSensetypeInjectedTextMagic);
    CGEventKeyboardSetUnicodeString(down, 1, &ch);
    CGEventKeyboardSetUnicodeString(up, 1, &ch);
    CGEventPost(kCGHIDEventTap, down);
    CGEventPost(kCGHIDEventTap, up);
    CFRelease(down);
    CFRelease(up);
  }

  CFRelease(src);
  return ok;
}

static bool PostCommandCombo(CGKeyCode keyCode /* e.g. 8='C', 9='V' */) {
  // Use a private source + tag so our event tap ignores it, and clear flags to avoid combining
  // with any physical modifiers the user may be holding.
  static const int64_t kSensetypeInjectedComboMagic = 0x53454E5345545943LL; // "SENSETYC"
  CGEventSourceRef src = CGEventSourceCreate(kCGEventSourceStatePrivate);
  if (!src) return false;
  CGEventSourceSetLocalEventsSuppressionInterval(src, 0.0);

  // keydown/keyup for the character with Command flag only
  CGEventRef down = CGEventCreateKeyboardEvent(src, keyCode, true);
  CGEventRef up = CGEventCreateKeyboardEvent(src, keyCode, false);
  if (!down || !up) {
    if (down) CFRelease(down);
    if (up) CFRelease(up);
    CFRelease(src);
    return false;
  }
  CGEventSetIntegerValueField(down, kCGEventSourceUserData, kSensetypeInjectedComboMagic);
  CGEventSetIntegerValueField(up, kCGEventSourceUserData, kSensetypeInjectedComboMagic);
  CGEventSetFlags(down, kCGEventFlagMaskCommand);
  CGEventSetFlags(up, kCGEventFlagMaskCommand);
  CGEventPost(kCGHIDEventTap, down);
  CGEventPost(kCGHIDEventTap, up);
  CFRelease(down);
  CFRelease(up);
  CFRelease(src);
  return true;
}

bool SendCopyShortcut() {
  // 'C' keycode on macOS is 8
  return PostCommandCombo((CGKeyCode)8);
}

bool SendPasteShortcut() {
  // 'V' keycode on macOS is 9
  return PostCommandCombo((CGKeyCode)9);
}

bool StartHook(const HookConfig& config, EventBridge* bridge) {
  if (g_running.load()) return true;
  LogConstantsOnce();
  // If a previous start attempt is still in progress (possibly blocked in CGEventTapCreate),
  // do not start again (would race on globals). Return false so JS can fallback/retry later.
  if (g_starting.load()) return false;
  // If a previous thread object is joinable and we are not running/starting, join it to avoid
  // std::terminate on overwrite.
  if (g_thread.joinable() && !g_running.load() && !g_starting.load()) {
    g_thread.join();
  }
  g_delayMs.store(config.delayMs);
  g_key.store(config.key);
  g_comboEnabled.store(config.comboEnabled);
  g_altKeycode.store(DefaultHoldKeycode());
  g_bridge = bridge;
  g_running.store(true);
  g_ready.store(0);
  g_abortStart.store(false);
  g_starting.store(true);
  // Reset Fn+Space toggle state on (re)start to avoid stale "active" when hook is restarted.
  g_fnSpaceChord.store(false);
  g_fnSpaceSuppressUp.store(false);
  g_fnSpaceToggleActive.store(false);
  g_fnDownMaybe.store(false);
  g_lastFnSeenAt.store(0);
  const uint64_t token = g_startToken.fetch_add(1) + 1;

  // Put event tap onto a dedicated CFRunLoop thread (more reliable under Electron)
  g_thread = std::thread([token]() {
    // Keep thread-local runloop until we confirm this start attempt is still current.
    CFRunLoopRef localRunLoop = CFRunLoopGetCurrent();

    CGEventMask mask = CGEventMaskBit(kCGEventKeyDown) |
                       CGEventMaskBit(kCGEventKeyUp) |
                       CGEventMaskBit(kCGEventFlagsChanged) |
                       CGEventMaskBit(kCGEventLeftMouseDown) |
                       CGEventMaskBit(kCGEventLeftMouseUp) |
                       CGEventMaskBit(kCGEventRightMouseDown) |
                       CGEventMaskBit(kCGEventRightMouseUp) |
                       CGEventMaskBit(kCGEventOtherMouseDown) |
                       CGEventMaskBit(kCGEventOtherMouseUp) |
                       CGEventMaskBit(kCGEventMouseMoved) |
                       CGEventMaskBit(kCGEventLeftMouseDragged) |
                       CGEventMaskBit(kCGEventRightMouseDragged) |
                       CGEventMaskBit(kCGEventOtherMouseDragged) |
                       CGEventMaskBit(kCGEventScrollWheel);
    CFMachPortRef localTap = CGEventTapCreate(kCGHIDEventTap,
                                             kCGHeadInsertEventTap,
                                             kCGEventTapOptionDefault,
                                             mask,
                                             TapCallback,
                                             nullptr);
    if (!localTap) {
      DebugLog("CGEventTapCreate failed");
      // Only publish failure if this attempt is still current.
      if (g_startToken.load() == token) {
        g_ready.store(-1);
        g_running.store(false);
        g_starting.store(false);
      }
      return;
    }
    DebugLog("CGEventTapCreate ok");
    // If startup was aborted (e.g., JS timed out and returned), do not enter CFRunLoopRun().
    // Just clean up and exit the thread.
    if (!g_running.load() || g_abortStart.load() || g_startToken.load() != token) {
      DebugLog("CGEventTapCreate ok but start aborted; cleaning up without runloop");
      CGEventTapEnable(localTap, false);
      CFRelease(localTap);
      if (g_startToken.load() == token) {
        g_ready.store(-1);
        g_running.store(false);
        g_starting.store(false);
      }
      return;
    }
    // Publish globals for the current token.
    g_runLoop = localRunLoop;
    g_tap = localTap;
    g_ready.store(1);
    g_starting.store(false);

    g_source = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, g_tap, 0);
    CFRunLoopAddSource(g_runLoop, g_source, kCFRunLoopCommonModes);
    CGEventTapEnable(g_tap, true);

    CFRunLoopRun();

    // cleanup after runloop stopped
    // Only the current owner (token) should tear down globals.
    if (g_startToken.load() == token) {
      if (g_source) {
        CFRunLoopRemoveSource(g_runLoop, g_source, kCFRunLoopCommonModes);
        CFRelease(g_source);
        g_source = nullptr;
      }
      if (g_tap) {
        CGEventTapEnable(g_tap, false);
        CFRelease(g_tap);
        g_tap = nullptr;
      }
      g_runLoop = nullptr;
    } else {
      // If token changed, best-effort local cleanup (globals belong to someone else).
      if (localTap) {
        CGEventTapEnable(localTap, false);
      }
    }
  });

  // Wait briefly for tap creation result so JS can decide whether to fallback.
  const uint64_t start = NowMs();
  while (g_ready.load() == 0 && (NowMs() - start) < 500) {
    std::this_thread::sleep_for(std::chrono::milliseconds(5));
  }
  const int ready = g_ready.load();
  if (ready == 1) {
    // Start watchdog AFTER tap thread is ready.
    const uint64_t seq = g_seq.fetch_add(1) + 1;
    EnsureTapWatchdog(seq);
    return true;
  }

  // Failed or timed out:
  // - If it's a real failure (g_ready == -1), joining is fine.
  // - If it timed out (g_ready still 0), CGEventTapCreate may be blocked; joining would deadlock.
  if (ready == -1) {
    if (g_thread.joinable()) {
      g_thread.join();
    }
    if (g_pollThread.joinable()) {
      g_pollThread.join();
    }
    if (g_tapWatchdogThread.joinable()) {
      g_tapWatchdogThread.join();
    }
    g_bridge = nullptr;
    g_running.store(false);
    return false;
  }

  // Timeout: abort startup and return false without joining.
  g_abortStart.store(true);
  g_running.store(false);
  g_bridge = nullptr;
  // Allow retries: invalidate this start attempt token and detach the blocked thread.
  g_startToken.fetch_add(1);
  g_starting.store(false);
  if (g_thread.joinable()) {
    g_thread.detach();
  }
  return false;
}

void StopHook() {
  // Stop can be called when running OR while starting.
  if (!g_running.load() && !g_starting.load()) return;
  g_abortStart.store(true);
  // Invalidate any in-flight start attempt so it won't publish into globals later.
  g_startToken.fetch_add(1);
  g_running.store(false);
  g_altDown.store(false);
  g_started.store(false);
  g_inCombo.store(false);
  g_suppressedDown.store(false);
  g_fnSpaceChord.store(false);
  g_fnSpaceSuppressUp.store(false);
  g_fnSpaceToggleActive.store(false);
  g_fnDownMaybe.store(false);
  g_lastFnSeenAt.store(0);
  g_seq.fetch_add(1);
  g_bridge = nullptr;

  if (g_runLoop) {
    CFRunLoopStop(g_runLoop);
    // Without an explicit wake-up, the runloop may stay blocked in mach_msg until
    // the next input event arrives, which can make stop()->join() block the caller.
    CFRunLoopWakeUp(g_runLoop);
  }
  if (g_thread.joinable()) {
    // If the tap thread is still in startup (g_ready==0), it may be blocked in CGEventTapCreate.
    // Joining here would hard-freeze the JS/Electron main thread. Detach instead.
    if (g_starting.load() && g_ready.load() == 0) {
      g_thread.detach();
    } else {
      g_thread.join();
    }
  }
  if (g_pollThread.joinable()) {
    g_pollThread.join();
  }
  if (g_releaseThread.joinable()) {
    g_releaseThread.join();
  }
  if (g_tapWatchdogThread.joinable()) {
    g_tapWatchdogThread.join();
  }
}

bool IsHookRunning() {
  // Health check must include tap enabled state.
  // In long background sessions macOS may disable the event tap while threads still exist;
  // in that case we must report "not running" so the JS watchdog can restart.
  if (!g_running.load() || g_tap == nullptr || g_runLoop == nullptr) return false;
  return CGEventTapIsEnabled(g_tap);
}

#endif
