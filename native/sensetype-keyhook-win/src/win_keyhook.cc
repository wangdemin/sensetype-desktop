// Windows 键盘钩子核心逻辑（whitelist v2）。
// 职责：WH_KEYBOARD_LL 钩子回调、轮询模式、长按状态线程、Ctrl+Win 组合键线程。
// 文本注入/窗口检测/修饰键释放等工具函数已提取到 win_utils.cc。

#include "api.h"

#if defined(SENSETYPE_KEYHOOK_WIN)

#include "hook_state.h"
#include "intercept_policy.h"
#include "vk_mapping.h"
#include "win_utils.h"

#include <Windows.h>
#include <atomic>
#include <thread>
#include <cstdio>

// ─── 全局状态（单例） ───

static HookState g_state;

// ─── 调试支持（启动时缓存，避免每次调用 getenv） ───

static bool g_debugEnabled = false;

static void InitDebugFlag() {
  const char* v = std::getenv("SENSETYPE_KEYHOOK_DEBUG");
  g_debugEnabled = v && v[0] != '\0' && v[0] != '0';
}

static void DebugEvent(const char* tag, const KBDLLHOOKSTRUCT* kb, bool matchedHold) {
  if (!g_debugEnabled) return;
  std::fprintf(
    stderr,
    "[sensetype-keyhook:win] %s vk=0x%02lx sc=0x%02lx flags=0x%02lx "
    "matchedHold=%d holdDown=%d started=%d inCombo=%d\n",
    tag,
    (unsigned long)kb->vkCode,
    (unsigned long)kb->scanCode,
    (unsigned long)kb->flags,
    matchedHold ? 1 : 0,
    g_state.holdDown.load() ? 1 : 0,
    g_state.started.load() ? 1 : 0,
    g_state.inCombo.load() ? 1 : 0
  );
  std::fflush(stderr);
}

// ─── 钩子回调中的按键匹配 ───
// 判断当前键盘事件是否为配置的长按键。
// 对右 Alt (key=6) 做了复杂的兼容处理：
//   - 部分环境将右 Alt 报告为 VK_MENU（无 EXTENDED 标志）
//   - keyup 时 GetAsyncKeyState 可能已经是 "up"，需要依赖锁存的 VK 匹配

static bool IsHoldKey(const KBDLLHOOKSTRUCT* kb, bool isKeyDown, bool isKeyUp) {
  const uint32_t k = g_state.key.load();
  const DWORD vk = kb->vkCode;
  const DWORD flags = kb->flags;

  switch (k) {
    case 0: // Alt (左/右)
      return vk == VK_MENU || vk == VK_LMENU || vk == VK_RMENU;
    case 1: return vk == VK_CONTROL || vk == VK_LCONTROL || vk == VK_RCONTROL;
    case 2: return vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT;
    case 3: return vk == VK_LWIN || vk == VK_RWIN;
    case 4: return vk == VK_RSHIFT;
    case 5: return vk == VK_RCONTROL || (vk == VK_CONTROL && (flags & LLKHF_EXTENDED));
    case 6: {
      if (vk == VK_RMENU) return true;
      if (vk == VK_MENU) {
        if (isKeyUp && g_state.holdDown.load()) {
          const DWORD held = g_state.holdVk.load();
          if (held == VK_RMENU || held == VK_MENU || held == VK_LMENU) return true;
        }
        if (flags & LLKHF_EXTENDED) return true;
        if (isKeyDown) {
          if (IsVkDown(VK_RMENU) && !IsVkDown(VK_LMENU)) return true;
        }
      }
      return false;
    }
    case 7:  // 左 Alt
      return vk == VK_LMENU || (vk == VK_MENU && !(flags & LLKHF_EXTENDED));
    case 8:  // 左 Ctrl
      return vk == VK_LCONTROL || (vk == VK_CONTROL && !(flags & LLKHF_EXTENDED));
    case 9:  // 左 Shift
      return vk == VK_LSHIFT || (vk == VK_SHIFT && !(flags & LLKHF_EXTENDED));
    case 10: // 左 Win
      return vk == VK_LWIN;
    default: return false;
  }
}

// ─── 低级键盘钩子回调 ───

static LRESULT CALLBACK LowLevelKeyboardProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode < 0) return CallNextHookEx(g_state.hook, nCode, wParam, lParam);

  const KBDLLHOOKSTRUCT* kb = reinterpret_cast<KBDLLHOOKSTRUCT*>(lParam);
  const DWORD vk = kb->vkCode;
  const bool isKeyDown = (wParam == WM_KEYDOWN || wParam == WM_SYSKEYDOWN);
  const bool isKeyUp   = (wParam == WM_KEYUP   || wParam == WM_SYSKEYUP);

  if (g_debugEnabled) {
    std::fprintf(stderr, "[raw-hook] vk=0x%02lx flags=0x%02lx msg=%s\n",
      (unsigned long)vk, (unsigned long)kb->flags,
      isKeyDown ? "down" : (isKeyUp ? "up" : "other"));
    std::fflush(stderr);
  }

  // 忽略注入事件（如 SendInput），避免自干扰
  if (kb->flags & LLKHF_INJECTED) {
    return CallNextHookEx(g_state.hook, nCode, wParam, lParam);
  }

  const uint32_t currentKey = g_state.key.load();
  const bool isCtrl = (vk == VK_LCONTROL || vk == VK_RCONTROL || vk == VK_CONTROL);
  const bool isWin  = (vk == VK_LWIN || vk == VK_RWIN);
  const bool isHold = IsHoldKey(kb, isKeyDown, isKeyUp);
  const bool comboEnabled = g_state.comboEnabled.load();
  const bool systemInterceptionMode = IsSystemInterceptionMode(currentKey);

  // ─── Ctrl+Win 组合键检测 ───

  if (comboEnabled) {
    if (isCtrl) g_state.ctrlDown.store(isKeyDown);
    if (isWin)  g_state.winDown.store(isKeyDown);
  }

  // Ctrl+Win 和弦检测/启动/停止（切换录音模式）
  if (comboEnabled && g_state.ctrlDown.load() && g_state.winDown.load()) {
    if (!g_state.ctrlWinChord.load()) {
      g_state.ctrlWinChord.store(true);
      if (g_debugEnabled) {
        std::fprintf(stderr, "[sensetype-keyhook:win] Ctrl+Win chord DETECTED. active=%d\n",
          g_state.ctrlWinToggleActive.load());
      }
      if (g_state.ctrlWinToggleActive.load()) {
        // 第二次按下：立即停止
        g_state.ctrlWinToggleActive.store(false);
        g_state.ctrlWinSuppressStart.store(true);
        if (g_state.bridge) g_state.bridge->EmitStop();
      } else {
        // 第一次按下：准备在释放时启动
        g_state.ctrlWinSuppressStart.store(false);
      }
    }
  }

  if (comboEnabled && isKeyUp && (isCtrl || isWin)) {
    if (g_state.ctrlWinChord.load()) {
      if (!g_state.ctrlWinSuppressStart.load() && !g_state.ctrlWinToggleActive.load()) {
        if (g_debugEnabled) std::fprintf(stderr, "[sensetype-keyhook:win] Ctrl+Win triggers START\n");
        g_state.ctrlWinToggleActive.store(true);
        if (g_state.bridge) g_state.bridge->EmitStart();
      } else {
        if (g_debugEnabled) std::fprintf(stderr, "[sensetype-keyhook:win] Ctrl+Win release (suppressed or already active)\n");
      }
      g_state.ctrlWinChord.store(false);
    }
  }

  // 调试：记录修饰键事件
  if (vk == VK_MENU || vk == VK_RMENU || vk == VK_LMENU ||
      vk == VK_CONTROL || vk == VK_RCONTROL || vk == VK_LCONTROL ||
      vk == VK_LWIN || vk == VK_RWIN ||
      vk == VK_SHIFT || vk == VK_LSHIFT || vk == VK_RSHIFT) {
    DebugEvent(isKeyDown ? "keydown" : (isKeyUp ? "keyup" : "other"), kb, isHold);
  }

  // 对 Alt/Win 这类系统键，从 hook keydown 开始立刻进入吞键窗口。
  // 这样可以覆盖 poll 线程尚未来得及更新 holdDown 的短时间窗口。
  if (systemInterceptionMode && isHold) {
    if (isKeyDown) g_state.systemHoldInterceptActive.store(true);
    if (isKeyUp) g_state.systemHoldInterceptActive.store(false);
  }

  // ─── poll mode 下钩子只负责吞掉按键，不处理长按状态 ───
  // 长按状态转换完全由 poll mode 线程通过 GetAsyncKeyState 管理。
  const bool holdActiveForInterception =
    g_state.systemHoldInterceptActive.load() || g_state.holdDown.load();
  const bool shouldSwallow = ShouldSwallowKeyboardEvent({
    currentKey,
    holdActiveForInterception,
    g_state.started.load(),
    isHold,
    IsDedicatedRightAltMode(currentKey) && isCtrl,
  });
  if (shouldSwallow) return 1;

  return CallNextHookEx(g_state.hook, nCode, wParam, lParam);
}

// ─── 轮询模式（右 Shift / 右 Ctrl 的稳定回退方案） ───

static bool StartPollModeForCurrentKey() {
  const uint32_t k = g_state.key.load();
  VkSet vks;
  if (!ResolveVkSet(k, vks)) return false;

  std::fprintf(stderr, "[poll-mode] starting (whitelist-v3-noF13F24) for key=%u primary=0x%02lx secondary=0x%02lx tertiary=0x%02lx sibling=0x%02lx\n",
    k, (unsigned long)vks.primary, (unsigned long)vks.secondary,
    (unsigned long)vks.tertiary, (unsigned long)vks.sibling);
  std::fflush(stderr);

  g_state.pollRunning.store(true);
  g_state.pollThread = std::thread([vks, k]() {
    uint64_t downAt = 0;
    int holdUpStreak = 0;
    // 右 Alt(AltGr) 在部分驱动下 GetAsyncKeyState 会短时抖动成 up。
    // 使用短去抖窗口，避免出现 "start -> stop -> start" 连环触发。
    const int releaseDebounceTicks = IsDedicatedRightAltMode(k) ? 4 : 1; // 4 * 10ms = 40ms
    while (g_state.pollRunning.load()) {
      const bool holdDown = IsAnyVkDown(vks);

      if (holdDown) {
        holdUpStreak = 0;
        if (!g_state.holdDown.load()) {
          const DWORD otherVk = AnyOtherKeyDownDebug(vks);
          const bool hasOther = (otherVk != 0);
          g_state.holdDown.store(true);
          g_state.started.store(false);
          g_state.inCombo.store(hasOther);
          downAt = GetTickCount64();
          std::fprintf(stderr, "[poll-mode] hold DOWN detected. key=%u inCombo=%d otherVk=0x%02lx "
            "primary(%d) secondary(%d) tertiary(%d)\n",
            k, hasOther ? 1 : 0, (unsigned long)otherVk,
            IsVkDown((int)vks.primary) ? 1 : 0,
            (vks.secondary ? IsVkDown((int)vks.secondary) : 0) ? 1 : 0,
            (vks.tertiary ? IsVkDown((int)vks.tertiary) : 0) ? 1 : 0);
          std::fflush(stderr);
        } else if (!g_state.started.load()) {
          if (!g_state.inCombo.load()) {
            const DWORD otherVk = AnyOtherKeyDownDebug(vks);
            if (otherVk != 0) {
              g_state.inCombo.store(true);
              std::fprintf(stderr, "[poll-mode] combo detected during delay. otherVk=0x%02lx\n",
                (unsigned long)otherVk);
              std::fflush(stderr);
            }
          }
          const uint64_t now = GetTickCount64();
          const uint64_t elapsed = (now >= downAt) ? (now - downAt) : 0;
          if (!g_state.inCombo.load() && elapsed >= g_state.delayMs.load()) {
            g_state.started.store(true);
            std::fprintf(stderr, "[poll-mode] delay reached (%llums) -> EmitStart\n",
              (unsigned long long)elapsed);
            std::fflush(stderr);
            if (IsAnyAltHoldMode(k)) {
              // 关键修复：右 Alt 模式下不要在 start 时注入 Alt up。
              // 否则会把当前按住的右 Alt 瞬间打成 up，导致 poll 状态抖动反复触发。
              if (!IsDedicatedRightAltMode(k)) {
                ReleaseAllModifiersToOS();
              }
            }
            if (g_state.bridge) g_state.bridge->EmitStart();
          }
        } else {
          const DWORD otherVk = AnyOtherKeyDownDebug(vks);
          if (otherVk != 0) {
            std::fprintf(stderr, "[poll-mode] other key during recording -> EmitCancel. otherVk=0x%02lx\n",
              (unsigned long)otherVk);
            std::fflush(stderr);
            if (g_state.bridge) g_state.bridge->EmitCancel();
            g_state.started.store(false);
            g_state.inCombo.store(true);
          }
        }
      } else {
        if (g_state.holdDown.load()) {
          holdUpStreak += 1;
          if (holdUpStreak < releaseDebounceTicks) {
            Sleep(10);
            continue;
          }
          holdUpStreak = 0;
          const bool wasStarted = g_state.started.load();
          const bool wasInCombo = g_state.inCombo.load();
          g_state.holdDown.store(false);
          g_state.started.store(false);
          g_state.inCombo.store(false);
          g_state.systemHoldInterceptActive.store(false);
          std::fprintf(stderr, "[poll-mode] hold UP. wasStarted=%d wasInCombo=%d -> %s\n",
            wasStarted ? 1 : 0, wasInCombo ? 1 : 0,
            (wasStarted && !wasInCombo) ? "EmitStop" : "no-emit");
          std::fflush(stderr);
          if (wasStarted && !wasInCombo && g_state.bridge) {
            g_state.bridge->EmitStop();
          }
          if (IsAnyAltHoldMode(k)) {
            ReleaseAllModifiersToOS();
          }
        } else {
          holdUpStreak = 0;
        }
      }
      Sleep(10);
    }
  });
  return true;
}

// ─── 长按状态监控线程 ───
// 通过轮询物理按键状态来补偿钩子可能漏掉的 keyup 事件。
// 同时负责在延迟到达后触发 EmitStart。

static void StartHoldStateThread() {
  if (g_state.holdStateRunning.load()) return;
  if (g_state.holdStateThread.joinable()) g_state.holdStateThread.join();

  g_state.holdStateRunning.store(true);
  g_state.holdStateThread = std::thread([]() {
    int holdUpStreak = 0;
    while (g_state.holdStateRunning.load()) {
      if (!g_state.running.load()) break;

      if (!g_state.holdDown.load()) {
        holdUpStreak = 0;
        Sleep(10);
        continue;
      }

      const uint32_t currentKey = g_state.key.load();
      const DWORD latchedVk = g_state.holdVk.load();

      // 延迟到达后触发启动
      if (!g_state.started.load() && !g_state.inCombo.load()) {
        const uint64_t downAt = g_state.holdDownTick.load();
        const uint64_t now = GetTickCount64();
        const uint64_t elapsed = (now >= downAt) ? (now - downAt) : 0;
        if (elapsed >= g_state.delayMs.load()) {
          // 防护漏掉的 keyup：如果长按键已经物理释放，不要触发启动
          if (!IsHoldVkDown(currentKey, latchedVk)) {
            g_state.ResetHold();
            ReleaseAllModifiersToOS();
            Sleep(10);
            continue;
          }
          g_state.started.store(true);
          // 防止 Alt 系修饰键泄漏到前台应用
          if (IsAnyAltHoldMode(currentKey)) {
            ReleaseAllModifiersToOS();
          }
          if (g_state.bridge) g_state.bridge->EmitStart();
        }
      }

      // 检测物理按键是否已释放（补偿漏掉的 keyup）
      if (g_state.holdDown.load()) {
        if (IsHoldVkDown(currentKey, latchedVk)) {
          holdUpStreak = 0;
        } else {
          holdUpStreak += 1;
          if (holdUpStreak >= 6) { // 约 120ms（20ms 轮询间隔 × 6）
            const bool wasStarted = g_state.started.load();
            const bool wasInCombo = g_state.inCombo.load();
            if (wasStarted && !wasInCombo && g_state.bridge) {
              g_state.bridge->EmitStop();
            }
            g_state.ResetHold();
            ReleaseAllModifiersToOS();
            holdUpStreak = 0;
          }
        }
      }

      Sleep(20);
    }
    g_state.holdStateRunning.store(false);
  });
}

// ─── Ctrl+Win 轮询线程 ───
// 作为钩子的稳健回退方案（钩子在某些焦点输入框中可能被阻塞）。

static void StartCtrlWinPollThread() {
  if (!g_state.comboEnabled.load()) return;
  if (g_state.ctrlWinPollRunning.load()) return;
  if (g_state.ctrlWinPollThread.joinable()) g_state.ctrlWinPollThread.join();

  g_state.ctrlWinPollRunning.store(true);
  g_state.ctrlWinPollThread = std::thread([]() {
    while (g_state.ctrlWinPollRunning.load()) {
      bool c = IsVkDown(VK_CONTROL) || IsVkDown(VK_LCONTROL) || IsVkDown(VK_RCONTROL);
      bool w = IsVkDown(VK_LWIN) || IsVkDown(VK_RWIN);

      g_state.ctrlDown.store(c);
      g_state.winDown.store(w);

      // 和弦检测（轮询版本）
      if (c && w) {
        if (!g_state.ctrlWinChord.load()) {
          g_state.ctrlWinChord.store(true);
          if (g_debugEnabled) std::fprintf(stderr, "[poll] Ctrl+Win chord DETECTED\n");
          if (g_state.ctrlWinToggleActive.load()) {
            g_state.ctrlWinToggleActive.store(false);
            g_state.ctrlWinSuppressStart.store(true);
            if (g_state.bridge) g_state.bridge->EmitStop();
          } else {
            g_state.ctrlWinSuppressStart.store(false);
          }
        }
      }

      // 和弦释放（轮询版本）
      if (g_state.ctrlWinChord.load() && (!c || !w)) {
        if (!g_state.ctrlWinSuppressStart.load() && !g_state.ctrlWinToggleActive.load()) {
          if (g_debugEnabled) std::fprintf(stderr, "[poll] Ctrl+Win triggers START\n");
          g_state.ctrlWinToggleActive.store(true);
          if (g_state.bridge) g_state.bridge->EmitStart();
        }
        g_state.ctrlWinChord.store(false);
      }
      Sleep(15);
    }
  });
}

// ─── api.h 中声明的公共接口实现 ───

bool StartHook(const HookConfig& config, EventBridge* bridge) {
  if (g_state.running.load()) return true;

  InitDebugFlag();

  // 重启前完全重置状态，避免锁屏/解锁后残留的吞键/注入标志
  g_state.ResetAll();
  g_state.comboEnabled.store(config.comboEnabled);
  g_state.holdStateRunning.store(false);
  if (g_state.holdStateThread.joinable()) {
    g_state.holdStateThread.join();
  }
  ReleaseAllModifiersToOS();
  g_state.delayMs.store(config.delayMs);
  g_state.key.store(config.key);
  g_state.bridge = bridge;

  g_state.running.store(true);
  g_state.hookInstallState.store(0);

  // 从配置初始化切换状态（跨重启保持）
  if (config.initialToggleState) {
    g_state.ctrlWinToggleActive.store(true);
  }

  // 始终启动 Ctrl+Win 轮询线程作为稳健回退
  StartCtrlWinPollThread();

  // 所有键统一使用 poll mode 检测长按状态（GetAsyncKeyState 比钩子更可靠）。
  // 同时安装 WH_KEYBOARD_LL 钩子用于：
  //   1. 吞掉 Alt/Win 键防止系统菜单
  //   2. Ctrl+Win 组合键检测
  //   3. 录音期间吞掉其他按键
  // 钩子在 poll mode 下不处理长按状态转换。

  // 先启动 poll mode 线程
  if (!StartPollModeForCurrentKey()) {
    g_state.running.store(false);
    return false;
  }

  // 再安装钩子（用于吞掉按键和组合键检测）
  g_state.hookThread = std::thread([]() {
    g_state.hookThreadId = GetCurrentThreadId();
    g_state.hook = SetWindowsHookExW(WH_KEYBOARD_LL, LowLevelKeyboardProc,
                                      GetModuleHandleW(nullptr), 0);
    if (!g_state.hook) {
      g_state.hookInstallState.store(-1);
      std::fprintf(stderr, "[keyhook] WH_KEYBOARD_LL install failed\n");
      std::fflush(stderr);
      return;
    }
    g_state.hookInstallState.store(1);
    std::fprintf(stderr, "[keyhook] WH_KEYBOARD_LL installed (swallow-only mode)\n");
    std::fflush(stderr);
    MSG msg;
    while (g_state.running.load() && GetMessageW(&msg, nullptr, 0, 0)) {
      TranslateMessage(&msg);
      DispatchMessageW(&msg);
    }
    if (g_state.hook) {
      UnhookWindowsHookEx(g_state.hook);
      g_state.hook = nullptr;
    }
    g_state.hookInstallState.store(g_state.running.load() ? -1 : 0);
  });

  // 等待 hook 安装结果：只有 hook 装成功，才能保证系统键被稳定吞掉。
  for (int i = 0; i < 100; i++) {
    if (g_state.hookInstallState.load() != 0) break;
    Sleep(5);
  }

  if (g_state.hookInstallState.load() != 1) {
    StopHook();
    return false;
  }
  return true;
}

void StopHook() {
  if (!g_state.running.load()) return;
  g_state.running.store(false);
  g_state.seq.fetch_add(1);

  g_state.JoinAllThreads();

  // 安全措施：始终释放修饰键并清除注入状态
  if (g_state.holdKeyInjected.load()) {
    InjectAltUpToOS();
    g_state.holdKeyInjected.store(false);
  }
  ReleaseAllModifiersToOS();
  g_state.ResetAll();
  g_state.bridge = nullptr;
}

bool IsHookRunning() {
  // 只有 hook 真正安装成功，才能保证系统键拦截稳定生效。
  return ShouldReportHookRunning(g_state.running.load(), g_state.hookInstallState.load());
}

bool IsHoldKeyDown() {
  return IsHoldVkDown(g_state.key.load(), g_state.holdVk.load());
}

bool ForceResetState() {
  g_state.seq.fetch_add(1); // 取消任何待定的延迟启动

  if (g_state.holdKeyInjected.load()) {
    InjectAltUpToOS();
    g_state.holdKeyInjected.store(false);
  }

  g_state.ResetAll();
  ReleaseAllModifiersToOS();
  return true;
}

#endif
