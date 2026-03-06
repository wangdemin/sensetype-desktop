#include <napi.h>

#include <atomic>
#include <memory>
#include <mutex>
#include <vector>

#include "mac_sck.h"

namespace {

std::unique_ptr<MacSckCapturer> g_cap;
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
          // ignore
        }
        delete msg;
      });
  if (st != napi_ok) delete msg;
}

Napi::Value StartCapture(const Napi::CallbackInfo& info) {
  Napi::Env env = info.Env();
  if (info.Length() < 1 || !info[0].IsObject()) {
    Napi::TypeError::New(env, "startCapture({ onPcm }) required").ThrowAsJavaScriptException();
    return env.Null();
  }

  Napi::Object opts = info[0].As<Napi::Object>();
  Napi::Value cbv = opts.Get("onPcm");
  if (!cbv.IsFunction()) {
    Napi::TypeError::New(env, "startCapture({ onPcm: function }) required")
        .ThrowAsJavaScriptException();
    return env.Null();
  }

  int preferredSr = 48000;
  int preferredCh = 2;
  try {
    Napi::Value sr = opts.Get("sampleRate");
    if (sr.IsNumber()) preferredSr = sr.As<Napi::Number>().Int32Value();
    Napi::Value ch = opts.Get("channels");
    if (ch.IsNumber()) preferredCh = ch.As<Napi::Number>().Int32Value();
  } catch (...) {
    // ignore
  }

  std::lock_guard<std::mutex> lk(g_mu);
  if (g_started.load()) {
    Napi::Object ret = Napi::Object::New(env);
    ret.Set("sampleRate", Napi::Number::New(env, g_cap ? g_cap->sample_rate() : preferredSr));
    ret.Set("channels", Napi::Number::New(env, 1));
    return ret;
  }

  Napi::Function cb = cbv.As<Napi::Function>();
  g_tsfn = Napi::ThreadSafeFunction::New(env, cb, "sensetype_system_audio_sck", 0, 1);

  g_cap = std::make_unique<MacSckCapturer>();
  g_cap->SetCallback(OnPcmFromCapturer, nullptr);

  const char* err = nullptr;
  const bool ok = g_cap->Start(preferredSr, preferredCh, &err);
  if (!ok) {
    if (g_tsfn) {
      g_tsfn.Release();
      g_tsfn = {};
    }
    g_cap.reset();
    g_started.store(false);
    std::string msg = err ? std::string(err) : std::string("failed to start ScreenCaptureKit audio");
    if (err) free((void*)err);
    Napi::Error::New(env, msg).ThrowAsJavaScriptException();
    return env.Null();
  }

  g_started.store(true);
  Napi::Object ret = Napi::Object::New(env);
  ret.Set("sampleRate", Napi::Number::New(env, g_cap->sample_rate()));
  ret.Set("channels", Napi::Number::New(env, 1));
  return ret;
}

Napi::Value StopCapture(const Napi::CallbackInfo& info) {
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
  api.Set("startCapture", Napi::Function::New(env, StartCapture));
  api.Set("stopCapture", Napi::Function::New(env, StopCapture));
  // aliases
  api.Set("start", api.Get("startCapture"));
  api.Set("stop", api.Get("stopCapture"));
  return api;
}

