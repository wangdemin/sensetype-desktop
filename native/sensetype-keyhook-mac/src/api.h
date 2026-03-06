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

  void Emit(const char* type, const char* key = nullptr) {
    if (!tsfn) return;
    struct EventData {
      std::string type;
      std::string key;
      bool hasKey;
    };
    auto* data = new EventData{type, key ? key : "", key != nullptr};
    
    napi_status status = tsfn.NonBlockingCall(
        data,
        [](Napi::Env env, Napi::Function cb, EventData* d) {
          Napi::Object obj = Napi::Object::New(env);
          obj.Set("type", d->type);
          if (d->hasKey) {
            obj.Set("key", d->key);
          }
          cb.Call({obj});
          delete d;
        });
    if (status != napi_ok) {
      delete data;
    }
  }

 private:
  Napi::ThreadSafeFunction tsfn;
};

// Implemented per platform:
bool StartHook(const HookConfig& config, EventBridge* bridge);
void StopHook();
bool IsHookRunning();

// Utilities (best-effort) for interacting with the OS active app.
// Used by cross-app selection read / paste fallback.
bool SendCopyShortcut();
bool SendPasteShortcut();

// Text injection (system-level):
// Inject Unicode text into the currently focused control.
// macOS implementation uses CGEventKeyboardSetUnicodeString + CGEventPost.
bool SendTextToActiveApp(const std::u16string& text);
