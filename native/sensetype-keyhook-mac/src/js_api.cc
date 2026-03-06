#include "api.h"

static HookConfig g_config;
static EventBridge* g_bridge_holder = nullptr;

static Napi::Value Version(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // compile-time tag to verify the loaded .node is fresh
  std::string v = std::string("sensetype-keyhook v3 ") + __DATE__ + " " + __TIME__;
  return Napi::String::New(env, v);
}

static Napi::Value Start(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 2 || !info[0].IsObject() || !info[1].IsFunction()) {
    Napi::TypeError::New(env, "start(options, onEvent) expected").ThrowAsJavaScriptException();
    return env.Null();
  }
  Napi::Object opts = info[0].As<Napi::Object>();
  if (opts.Has("delayMs") && opts.Get("delayMs").IsNumber()) {
    g_config.delayMs = opts.Get("delayMs").As<Napi::Number>().Uint32Value();
  }
  if (opts.Has("key")) {
    Napi::Value v = opts.Get("key");
    if (v.IsNumber()) {
      g_config.key = v.As<Napi::Number>().Uint32Value();
    } else if (v.IsString()) {
      const std::string s = v.As<Napi::String>().Utf8Value();
      // Cross-platform strings (interpreted per platform in native code)
      if (s == "option" || s == "alt") g_config.key = 0;
      else if (s == "ralt" || s == "rightalt" || s == "right_alt" || s == "rmenu") g_config.key = 6;
      else if (s == "control" || s == "ctrl") g_config.key = 1;
      else if (s == "shift") g_config.key = 2;
      else if (s == "rshift" || s == "rightshift" || s == "right_shift") g_config.key = 4;
      else if (s == "rctrl" || s == "rightctrl" || s == "right_ctrl") g_config.key = 5;
      else if (s == "command" || s == "cmd") g_config.key = 3;
      else if (s == "win") g_config.key = 3;
    }
  }
  if (opts.Has("comboEnabled") && opts.Get("comboEnabled").IsBoolean()) {
    g_config.comboEnabled = opts.Get("comboEnabled").As<Napi::Boolean>().Value();
  } else {
    g_config.comboEnabled = true;
  }

  if (g_bridge_holder) {
    // When hot-reloading/restarting, Start() may be called again while the hook is still running.
    // We must stop the hook before deleting the old EventBridge, otherwise native threads may
    // call into a freed ThreadSafeFunction (use-after-free) and crash the process.
    StopHook();
    // already started; replace callback
    g_bridge_holder->Shutdown();
    delete g_bridge_holder;
    g_bridge_holder = nullptr;
  }
  g_bridge_holder = new EventBridge(env, info[1].As<Napi::Function>());

  const bool ok = StartHook(g_config, g_bridge_holder);
  return Napi::Boolean::New(env, ok);
}

static Napi::Value Stop(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  StopHook();
  if (g_bridge_holder) {
    g_bridge_holder->Shutdown();
    delete g_bridge_holder;
    g_bridge_holder = nullptr;
  }
  return env.Undefined();
}

static Napi::Value IsRunning(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, IsHookRunning());
}

static Napi::Value SendText(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsString()) {
    Napi::TypeError::New(env, "sendText(text) expected").ThrowAsJavaScriptException();
    return env.Null();
  }
  const std::u16string text = info[0].As<Napi::String>().Utf16Value();
  const bool ok = SendTextToActiveApp(text);
  return Napi::Boolean::New(env, ok);
}

static Napi::Value SendCopy(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, SendCopyShortcut());
}

static Napi::Value SendPaste(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  return Napi::Boolean::New(env, SendPasteShortcut());
}

Napi::Object CreateApi(Napi::Env env) {
  Napi::Object exports = Napi::Object::New(env);
  exports.Set("start", Napi::Function::New(env, Start));
  exports.Set("stop", Napi::Function::New(env, Stop));
  exports.Set("isRunning", Napi::Function::New(env, IsRunning));
  exports.Set("sendCopy", Napi::Function::New(env, SendCopy));
  exports.Set("sendPaste", Napi::Function::New(env, SendPaste));
  exports.Set("sendText", Napi::Function::New(env, SendText));
  exports.Set("version", Napi::Function::New(env, Version));
  return exports;
}


