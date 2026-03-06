#include "win_loopback.h"

#include <Audioclient.h>
#include <Mmdeviceapi.h>
#include <combaseapi.h>
#include <initguid.h>
#include <mmreg.h>
#include <ks.h>
#include <ksmedia.h>

// Link: Ole32.lib, Avrt.lib (in binding.gyp)

static float pcm16_to_f32(int16_t s) {
  return (s < 0) ? (static_cast<float>(s) / 32768.0f) : (static_cast<float>(s) / 32767.0f);
}

static bool is_float32_format(const WAVEFORMATEX* fmt) {
  if (!fmt) return false;
  if (fmt->wFormatTag == WAVE_FORMAT_IEEE_FLOAT && fmt->wBitsPerSample == 32) return true;
  if (fmt->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
    const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(fmt);
    if (ext->Format.wBitsPerSample != 32) return false;
    return IsEqualGUID(ext->SubFormat, KSDATAFORMAT_SUBTYPE_IEEE_FLOAT);
  }
  return false;
}

static bool is_pcm16_format(const WAVEFORMATEX* fmt) {
  if (!fmt) return false;
  if (fmt->wFormatTag == WAVE_FORMAT_PCM && fmt->wBitsPerSample == 16) return true;
  if (fmt->wFormatTag == WAVE_FORMAT_EXTENSIBLE) {
    const auto* ext = reinterpret_cast<const WAVEFORMATEXTENSIBLE*>(fmt);
    if (ext->Format.wBitsPerSample != 16) return false;
    return IsEqualGUID(ext->SubFormat, KSDATAFORMAT_SUBTYPE_PCM);
  }
  return false;
}

WinLoopbackCapturer::WinLoopbackCapturer() {}
WinLoopbackCapturer::~WinLoopbackCapturer() { Stop(); }

void WinLoopbackCapturer::SetCallback(OnPcm cb, void* ctx) {
  cb_ = cb;
  cb_ctx_ = ctx;
}

bool WinLoopbackCapturer::Start() {
  if (running_.exchange(true)) return true;
  th_ = std::thread([this]() { ThreadMain(); });
  return true;
}

void WinLoopbackCapturer::Stop() {
  if (!running_.exchange(false)) return;
  if (th_.joinable()) th_.join();
}

void WinLoopbackCapturer::ThreadMain() {
  HRESULT hr = CoInitializeEx(nullptr, COINIT_MULTITHREADED);
  const bool co_inited = SUCCEEDED(hr) || hr == RPC_E_CHANGED_MODE;

  IMMDeviceEnumerator* enumerator = nullptr;
  IMMDevice* device = nullptr;
  IAudioClient* audio_client = nullptr;
  IAudioCaptureClient* capture_client = nullptr;

  WAVEFORMATEX* mix_fmt = nullptr;
  HANDLE evt = nullptr;

  auto cleanup = [&]() {
    if (evt) CloseHandle(evt);
    if (mix_fmt) CoTaskMemFree(mix_fmt);
    if (capture_client) capture_client->Release();
    if (audio_client) audio_client->Release();
    if (device) device->Release();
    if (enumerator) enumerator->Release();
    if (co_inited) CoUninitialize();
  };

  hr = CoCreateInstance(__uuidof(MMDeviceEnumerator), nullptr, CLSCTX_ALL,
                        __uuidof(IMMDeviceEnumerator), (void**)&enumerator);
  if (FAILED(hr)) {
    cleanup();
    return;
  }

  // Headphones (esp. Bluetooth) often become the default Multimedia/Communications endpoint.
  // Prefer eMultimedia for "system sound", then fallback to console/communications.
  hr = enumerator->GetDefaultAudioEndpoint(eRender, eMultimedia, &device);
  if (FAILED(hr) || !device) {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eConsole, &device);
  }
  if (FAILED(hr) || !device) {
    hr = enumerator->GetDefaultAudioEndpoint(eRender, eCommunications, &device);
  }
  if (FAILED(hr) || !device) {
    cleanup();
    return;
  }

  hr = device->Activate(__uuidof(IAudioClient), CLSCTX_ALL, nullptr, (void**)&audio_client);
  if (FAILED(hr)) {
    cleanup();
    return;
  }

  hr = audio_client->GetMixFormat(&mix_fmt);
  if (FAILED(hr) || !mix_fmt) {
    cleanup();
    return;
  }

  sample_rate_ = static_cast<int>(mix_fmt->nSamplesPerSec);

  // 100ms buffer
  const REFERENCE_TIME dur = 1000000;  // 100ms in 100-ns units
  DWORD flags = AUDCLNT_STREAMFLAGS_LOOPBACK | AUDCLNT_STREAMFLAGS_EVENTCALLBACK;

  hr = audio_client->Initialize(AUDCLNT_SHAREMODE_SHARED, flags, dur, 0, mix_fmt, nullptr);
  if (FAILED(hr)) {
    cleanup();
    return;
  }

  evt = CreateEvent(nullptr, FALSE, FALSE, nullptr);
  if (!evt) {
    cleanup();
    return;
  }
  hr = audio_client->SetEventHandle(evt);
  if (FAILED(hr)) {
    cleanup();
    return;
  }

  hr = audio_client->GetService(__uuidof(IAudioCaptureClient), (void**)&capture_client);
  if (FAILED(hr)) {
    cleanup();
    return;
  }

  hr = audio_client->Start();
  if (FAILED(hr)) {
    cleanup();
    return;
  }

  std::vector<float> mono;
  mono.reserve(4096);

  while (running_.load()) {
    DWORD wait = WaitForSingleObject(evt, 200);
    if (wait != WAIT_OBJECT_0) continue;

    UINT32 packet_frames = 0;
    hr = capture_client->GetNextPacketSize(&packet_frames);
    if (FAILED(hr)) continue;

    while (packet_frames > 0) {
      BYTE* data = nullptr;
      UINT32 frames = 0;
      DWORD pktFlags = 0;
      hr = capture_client->GetBuffer(&data, &frames, &pktFlags, nullptr, nullptr);
      if (FAILED(hr)) break;

      const int channels = static_cast<int>(mix_fmt->nChannels);
      const int bps = static_cast<int>(mix_fmt->wBitsPerSample);
      const bool silent = (pktFlags & AUDCLNT_BUFFERFLAGS_SILENT) != 0;

      mono.clear();
      mono.resize(frames);

      if (silent || !data) {
        for (UINT32 i = 0; i < frames; i++) mono[i] = 0.0f;
      } else if (is_float32_format(mix_fmt) && bps == 32) {
        const float* f = reinterpret_cast<const float*>(data);
        for (UINT32 i = 0; i < frames; i++) {
          float sum = 0.0f;
          for (int c = 0; c < channels; c++) sum += f[i * channels + c];
          mono[i] = sum / static_cast<float>(channels);
        }
      } else if (is_pcm16_format(mix_fmt) && bps == 16) {
        const int16_t* s = reinterpret_cast<const int16_t*>(data);
        for (UINT32 i = 0; i < frames; i++) {
          float sum = 0.0f;
          for (int c = 0; c < channels; c++) sum += pcm16_to_f32(s[i * channels + c]);
          mono[i] = sum / static_cast<float>(channels);
        }
      } else {
        // Unsupported format: emit silence to keep pipeline alive.
        for (UINT32 i = 0; i < frames; i++) mono[i] = 0.0f;
      }

      if (cb_) cb_(cb_ctx_, sample_rate_, mono.data(), mono.size());

      capture_client->ReleaseBuffer(frames);
      hr = capture_client->GetNextPacketSize(&packet_frames);
      if (FAILED(hr)) break;
    }
  }

  audio_client->Stop();
  cleanup();
}

