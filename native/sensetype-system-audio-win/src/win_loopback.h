#pragma once

#include <atomic>
#include <cstdint>
#include <memory>
#include <thread>
#include <vector>

// Minimal WASAPI loopback capturer (default render device).
// Outputs mono float32 PCM frames to a callback (ThreadSafeFunction).

class WinLoopbackCapturer {
 public:
  WinLoopbackCapturer();
  ~WinLoopbackCapturer();

  bool Start();
  void Stop();

  int sample_rate() const { return sample_rate_; }

  // Called on a background thread. PCM is mono float32.
  using OnPcm = void (*)(void* ctx, int sampleRate, const float* pcm, size_t frames);
  void SetCallback(OnPcm cb, void* ctx);

 private:
  void ThreadMain();

  std::atomic<bool> running_{false};
  std::thread th_;

  OnPcm cb_{nullptr};
  void* cb_ctx_{nullptr};

  int sample_rate_{48000};
};

