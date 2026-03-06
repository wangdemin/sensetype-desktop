#pragma once

#include <cstddef>

// Minimal ScreenCaptureKit audio capturer (macOS 13+).
// Calls callback on a background queue with mono float32 PCM.

class MacSckCapturer {
 public:
  MacSckCapturer();
  ~MacSckCapturer();

  using OnPcm = void (*)(void* ctx, int sampleRate, const float* pcm, size_t frames);
  void SetCallback(OnPcm cb, void* ctx);
  OnPcm cb() const { return cb_; }
  void* cb_ctx() const { return cb_ctx_; }
  void set_sample_rate(int sr) { sample_rate_ = sr; }

  // Returns true if capture started.
  // On failure, error message is written to out_error (nullable).
  bool Start(int preferredSampleRate, int preferredChannels, const char** out_error);
  void Stop();

  int sample_rate() const { return sample_rate_; }

 private:
  struct Impl;
  Impl* impl_;
  OnPcm cb_{nullptr};
  void* cb_ctx_{nullptr};
  int sample_rate_{48000};
};

