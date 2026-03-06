#pragma once
#include <napi.h>
#include <string>

// JS API:
// start({ delayMs?: number, key?: string | number }, onEvent)
// stop()
// onEvent({ type: 'start' | 'stop' })

struct HookConfig {
  uint32_t delayMs = 120;
  // Hotkey "single-key hold" selection.
  // - macOS: 0=option, 1=control, 2=shift, 3=command
  // - Windows: 0=alt, 1=control, 2=shift(any), 3=win, 4=right shift, 5=right ctrl, 6=right alt
  uint32_t key = 0;
  bool comboEnabled = true;
  bool initialToggleState = false;
};

class EventBridge {
 public:
  explicit EventBridge(Napi::Env env, Napi::Function onEvent)
      : tsfn(Napi::ThreadSafeFunction::New(
            env,
            onEvent,
            "sensetype-keyhook",
            // IMPORTANT:
            // Do NOT use an unbounded queue + BlockingCall from input hook threads.
            // The hook thread may call into TSFN while JS is executing stop(), and stop() joins
            // the hook thread -> classic deadlock (app hard-freeze).
            //
            // NonBlockingCall avoids waiting on the JS thread. We keep a small queue because
            // this addon only emits a tiny set of events (start/stop/cancel).
            64,
            1)) {}

  void EmitStart() { Emit("start"); }
  void EmitStop() { Emit("stop"); }
  void EmitCancel() { Emit("cancel"); }

  void Shutdown() {
    if (tsfn) {
      // Drop any queued callbacks immediately; subsequent calls will fail fast.
      tsfn.Abort();
      tsfn.Release();
      tsfn = nullptr;
    }
  }

 private:
  void Emit(const char* type) {
    if (!tsfn) return;
    auto* payload = new std::string(type);
    napi_status status = tsfn.NonBlockingCall(
        payload,
        [](Napi::Env env, Napi::Function cb, std::string* value) {
          Napi::Object obj = Napi::Object::New(env);
          obj.Set("type", *value);
          cb.Call({obj});
          delete value;
        });
    if (status != napi_ok) {
      // if JS is gone, just leak-safe delete
      delete payload;
    }
  }

  Napi::ThreadSafeFunction tsfn;
};

// Implemented per platform:
bool StartHook(const HookConfig& config, EventBridge* bridge);
void StopHook();
bool IsHookRunning();

// Utilities (best-effort) for interacting with the OS active app.
// Windows implementation uses SendInput to avoid slow PowerShell/SendKeys.
bool SendPasteShortcut();
bool SendCopyShortcut();

// Text injection (system-level): inject UTF-16 text into focused control.
bool SendTextToActiveApp(const std::u16string& text);

// Win-only: inject text via PostMessage(WM_CHAR) — bypasses KEYEVENTF_UNICODE/VK_PACKET pipeline.
// Preferred for Chromium-based apps (WeChat, DingTalk) where VK_PACKET causes duplicate characters.
bool SendTextViaWmChar(const std::u16string& text);

// Win-only: send Shift+Enter to active app (used for chat apps newline without sending).
bool SendShiftEnterToActiveApp();

// Win-only: best-effort get foreground process base name (e.g. "WXWork.exe").
std::string GetForegroundProcessNameUtf8();

// Win-only: get foreground process full image path (e.g. "C:\\Program Files\\Tencent\\WeChat\\WeChat.exe").
std::string GetForegroundProcessPathUtf8();

// Win-only: get foreground window class name (e.g. "WeChatMainWndForPC", "ChatWnd").
// Useful as a fallback when process name matching is ambiguous or OpenProcess fails.
std::string GetForegroundWindowClassNameUtf8();

// Query current physical key state (best-effort).
// Windows uses GetAsyncKeyState so it works even when keyUp is not delivered to the app/webContents.
bool IsHoldKeyDown();

// Win-only: force reset internal hold/recording state and release modifiers (best-effort).
// Used as a safety valve when the focused app eats keyUp events.
bool ForceResetState();


