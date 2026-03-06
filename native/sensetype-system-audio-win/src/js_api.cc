#include <napi.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

#include "win_loopback.h"

namespace {

std::unique_ptr<WinLoopbackCapturer> g_cap;
std::mutex g_mu;

Napi::ThreadSafeFunction g_tsfn;
std::atomic<bool> g_started{false};

struct PcmMsg {
  int sample_rate;
  std::vector<float> pcm;  // mono
};

void OnPcmFromCapturer(void* /*ctx*/, int sampleRate, const float* pcm, size_t frames) {
  if (!g_started.load()) return;
  if (!g_tsfn) return;
  auto* msg = new PcmMsg();
  msg->sample_rate = sampleRate;
  msg->pcm.assign(pcm, pcm + frames);
  napi_status st = g_tsfn.BlockingCall(
      msg, [](Napi::Env env, Napi::Function jsCallback, PcmMsg* msg) {
        Napi::HandleScope scope(env);
        try {
          const size_t n = msg->pcm.size();
          auto arr = Napi::Float32Array::New(env, n);
          for (size_t i = 0; i < n; i++) arr[i] = msg->pcm[i];
          Napi::Object payload = Napi::Object::New(env);
          payload.Set("sampleRate", Napi::Number::New(env, msg->sample_rate));
          payload.Set("channels", Napi::Number::New(env, 1));
          payload.Set("pcm", arr);
          jsCallback.Call({payload});
        } catch (...) {
          // ignore callback errors
        }
        delete msg;
      });
  if (st != napi_ok) {
    delete msg;
  }
}

Napi::Value StartLoopback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  // Accept either:
  // - startLoopback(callback)
  // - startLoopback({ onPcm: (payload) => void, sampleRate?, channels?, format? })
  bool hasCb = false;
  Napi::Function cb = Napi::Function();
  if (info.Length() >= 1 && info[0].IsFunction()) {
    cb = info[0].As<Napi::Function>();
    hasCb = true;
  } else if (info.Length() >= 1 && info[0].IsObject()) {
    Napi::Object opts = info[0].As<Napi::Object>();
    Napi::Value v = opts.Get("onPcm");
    if (v.IsFunction()) {
      cb = v.As<Napi::Function>();
      hasCb = true;
    }
  }
  if (!hasCb) {
    Napi::TypeError::New(env, "startLoopback(callback) or startLoopback({onPcm}) required")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  std::lock_guard<std::mutex> lk(g_mu);
  if (g_started.load()) return Napi::Boolean::New(env, true);

  g_tsfn = Napi::ThreadSafeFunction::New(env, cb, "sensetype_system_audio_loopback", 0, 1);

  g_cap = std::make_unique<WinLoopbackCapturer>();
  g_cap->SetCallback(OnPcmFromCapturer, nullptr);
  g_started.store(true);
  g_cap->Start();
  Napi::Object ret = Napi::Object::New(env);
  ret.Set("sampleRate", Napi::Number::New(env, g_cap->sample_rate()));
  ret.Set("channels", Napi::Number::New(env, 1));
  return ret;
}

Napi::Value StopLoopback(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  std::lock_guard<std::mutex> lk(g_mu);
  if (!g_started.load()) return env.Undefined();
  g_started.store(false);
  if (g_cap) {
    g_cap->Stop();
    g_cap.reset();
  }
  if (g_tsfn) {
    g_tsfn.Release();
    g_tsfn = {};
  }
  return env.Undefined();
}

}  // namespace

Napi::Object CreateApi(Napi::Env env) {
  Napi::Object api = Napi::Object::New(env);
  api.Set("startLoopback", Napi::Function::New(env, StartLoopback));
  api.Set("stopLoopback", Napi::Function::New(env, StopLoopback));
  return api;
}

