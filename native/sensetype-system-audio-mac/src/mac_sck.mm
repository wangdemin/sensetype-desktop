#import "mac_sck.h"

#import <Foundation/Foundation.h>

// ScreenCaptureKit is available macOS 12.3+, but we target macOS 13+ as requested.
#import <ScreenCaptureKit/ScreenCaptureKit.h>
#import <CoreMedia/CoreMedia.h>

#include <atomic>
#include <vector>
#include <algorithm>
#include <cstring>
#include <cstdlib>

// Helpers
static float pcm16_to_f32(int16_t s) {
  return (s < 0) ? (static_cast<float>(s) / 32768.0f) : (static_cast<float>(s) / 32767.0f);
}

@interface STAudioOutput : NSObject <SCStreamOutput>
@property(nonatomic, assign) MacSckCapturer* owner;
@property(nonatomic, strong) dispatch_queue_t queue;
@end

@implementation STAudioOutput
- (void)stream:(SCStream*)stream didOutputSampleBuffer:(CMSampleBufferRef)sampleBuffer ofType:(SCStreamOutputType)type {
  (void)stream;
  if (type != SCStreamOutputTypeAudio) return;
  if (!self.owner) return;

  if (!CMSampleBufferIsValid(sampleBuffer)) return;

  // Determine sample rate from format description
  CMAudioFormatDescriptionRef fmtDesc = (CMAudioFormatDescriptionRef)CMSampleBufferGetFormatDescription(sampleBuffer);
  const AudioStreamBasicDescription* asbd = CMAudioFormatDescriptionGetStreamBasicDescription(fmtDesc);
  if (!asbd) return;

  const int sr = (int)asbd->mSampleRate;
  const int channels = (int)asbd->mChannelsPerFrame;

  // IMPORTANT:
  // AudioBufferList has a flexible array member; using a stack ABL with size=sizeof(ABL)
  // only works for 1 buffer. Many pipelines output non-interleaved buffers (multiple buffers),
  // which would make CMSampleBufferGetAudioBufferList... fail and we'd get no audio.
  CMBlockBufferRef blockBuffer = NULL;
  size_t ablSize = 0;
  // First pass: query needed size.
  OSStatus st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      &ablSize,
      NULL,
      0,
      NULL,
      NULL,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      &blockBuffer);
  if (st != noErr || ablSize == 0) {
    if (blockBuffer) CFRelease(blockBuffer);
    return;
  }
  AudioBufferList* abl = (AudioBufferList*)malloc(ablSize);
  if (!abl) {
    if (blockBuffer) CFRelease(blockBuffer);
    return;
  }
  memset(abl, 0, ablSize);
  st = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(
      sampleBuffer,
      &ablSize,
      abl,
      ablSize,
      NULL,
      NULL,
      kCMSampleBufferFlag_AudioBufferList_Assure16ByteAlignment,
      &blockBuffer);
  if (st != noErr) {
    if (blockBuffer) CFRelease(blockBuffer);
    free(abl);
    return;
  }

  // We expect interleaved float32 or int16 PCM depending on system pipeline.
  const uint32_t bytesPerFrame = asbd->mBytesPerFrame;
  const uint32_t bitsPerChannel = asbd->mBitsPerChannel;
  const bool isFloat = (asbd->mFormatFlags & kAudioFormatFlagIsFloat) != 0;
  const bool isSignedInt = (asbd->mFormatFlags & kAudioFormatFlagIsSignedInteger) != 0;
  const uint32_t bytesPerSample = bitsPerChannel ? (bitsPerChannel / 8) : 0;

  // Sum across all buffers (some pipelines provide non-interleaved buffers).
  // For simplicity, we will treat each AudioBuffer as separate channel planes when non-interleaved.
  // We downmix to mono by averaging channels.
  size_t frameCount = (size_t)CMSampleBufferGetNumSamples(sampleBuffer);
  if (frameCount == 0) {
    if (blockBuffer) CFRelease(blockBuffer);
    return;
  }

  std::vector<float> mono;
  mono.resize(frameCount);
  for (size_t i = 0; i < frameCount; i++) mono[i] = 0.0f;

  // Case A: single buffer with interleaved channels
  if (abl->mNumberBuffers == 1 && channels > 1) {
    const AudioBuffer buf = abl->mBuffers[0];
    if (!buf.mData || buf.mDataByteSize == 0) {
      // silence
    } else if (isFloat && bitsPerChannel == 32) {
      const float* f = (const float*)buf.mData;
      for (size_t i = 0; i < frameCount; i++) {
        float sum = 0.0f;
        for (int c = 0; c < channels; c++) sum += f[i * (size_t)channels + (size_t)c];
        mono[i] = sum / (float)channels;
      }
    } else if (!isFloat && isSignedInt && bitsPerChannel == 16) {
      const int16_t* s = (const int16_t*)buf.mData;
      for (size_t i = 0; i < frameCount; i++) {
        float sum = 0.0f;
        for (int c = 0; c < channels; c++) sum += pcm16_to_f32(s[i * (size_t)channels + (size_t)c]);
        mono[i] = sum / (float)channels;
      }
    } else {
      // unsupported; emit silence
    }
  } else {
    // Case B: non-interleaved buffers or mono
    const int bufferCount = (int)abl->mNumberBuffers;
    int effectiveChannels = channels;
    if (bufferCount > 0) effectiveChannels = bufferCount;

    for (int b = 0; b < bufferCount; b++) {
      const AudioBuffer buf = abl->mBuffers[b];
      if (!buf.mData || buf.mDataByteSize == 0) continue;
      if (isFloat && bitsPerChannel == 32) {
        const float* f = (const float*)buf.mData;
        const size_t framesInBuf = bytesPerSample
            ? (buf.mDataByteSize / (size_t)bytesPerSample)
            : (bytesPerFrame ? (buf.mDataByteSize / (size_t)bytesPerFrame) : frameCount);
        const size_t n = std::min(frameCount, framesInBuf);
        for (size_t i = 0; i < n; i++) mono[i] += f[i];
      } else if (!isFloat && isSignedInt && bitsPerChannel == 16) {
        const int16_t* s = (const int16_t*)buf.mData;
        const size_t framesInBuf = bytesPerSample
            ? (buf.mDataByteSize / (size_t)bytesPerSample)
            : (bytesPerFrame ? (buf.mDataByteSize / (size_t)bytesPerFrame) : frameCount);
        const size_t n = std::min(frameCount, framesInBuf);
        for (size_t i = 0; i < n; i++) mono[i] += pcm16_to_f32(s[i]);
      }
    }
    if (effectiveChannels > 1) {
      for (size_t i = 0; i < frameCount; i++) mono[i] /= (float)effectiveChannels;
    }
  }

  if (blockBuffer) CFRelease(blockBuffer);
  free(abl);

  // Call C++ callback
  MacSckCapturer::OnPcm cb = self.owner->cb();
  if (cb) cb(self.owner->cb_ctx(), sr, mono.data(), mono.size());
  self.owner->set_sample_rate(sr);
}
@end

struct MacSckCapturer::Impl {
  STAudioOutput* output = nil;
  SCStream* stream = nil;
  dispatch_queue_t queue = nil;
  std::atomic<bool> running{false};
};

MacSckCapturer::MacSckCapturer() : impl_(new Impl()) {}
MacSckCapturer::~MacSckCapturer() {
  Stop();
  delete impl_;
  impl_ = nullptr;
}

void MacSckCapturer::SetCallback(OnPcm cb, void* ctx) {
  cb_ = cb;
  cb_ctx_ = ctx;
}

bool MacSckCapturer::Start(int preferredSampleRate, int preferredChannels, const char** out_error) {
  if (impl_->running.exchange(true)) return true;
  sample_rate_ = preferredSampleRate > 0 ? preferredSampleRate : 48000;

  if (@available(macOS 13.0, *)) {
    dispatch_semaphore_t sem = dispatch_semaphore_create(0);
    __block BOOL ok = NO;
    __block NSString* errStr = nil;

    impl_->queue = dispatch_queue_create("sensetype.sck.audio", DISPATCH_QUEUE_SERIAL);
    impl_->output = [STAudioOutput new];
    impl_->output.owner = this;
    impl_->output.queue = impl_->queue;

    [SCShareableContent getShareableContentWithCompletionHandler:^(SCShareableContent* content, NSError* error) {
      if (error || !content) {
        errStr = error ? [error localizedDescription] : @"failed to get shareable content";
        dispatch_semaphore_signal(sem);
        return;
      }
      SCDisplay* display = content.displays.firstObject;
      if (!display) {
        errStr = @"no display found";
        dispatch_semaphore_signal(sem);
        return;
      }

      SCContentFilter* filter = [[SCContentFilter alloc] initWithDisplay:display excludingWindows:@[]];
      SCStreamConfiguration* config = [SCStreamConfiguration new];
      config.capturesAudio = YES;
      // These fields exist on macOS 13+.
      config.sampleRate = preferredSampleRate > 0 ? preferredSampleRate : 48000;
      config.channelCount = preferredChannels > 0 ? preferredChannels : 2;

      impl_->stream = [[SCStream alloc] initWithFilter:filter configuration:config delegate:nil];
      NSError* addErr = nil;
      BOOL added = [impl_->stream addStreamOutput:impl_->output type:SCStreamOutputTypeAudio sampleHandlerQueue:impl_->queue error:&addErr];
      if (!added || addErr) {
        errStr = addErr ? [addErr localizedDescription] : @"failed to add stream output";
        dispatch_semaphore_signal(sem);
        return;
      }

      [impl_->stream startCaptureWithCompletionHandler:^(NSError* startErr) {
        if (startErr) {
          errStr = [startErr localizedDescription];
          dispatch_semaphore_signal(sem);
          return;
        }
        ok = YES;
        dispatch_semaphore_signal(sem);
      }];
    }];

    // Wait up to 3 seconds for start (avoid blocking forever)
    dispatch_time_t t = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(3 * NSEC_PER_SEC));
    long waited = dispatch_semaphore_wait(sem, t);
    if (waited != 0) {
      errStr = @"startCapture timeout";
      ok = NO;
    }

    if (!ok) {
      if (out_error) *out_error = strdup([(errStr ?: @"unknown error") UTF8String]);
      Stop();
      return false;
    }

    return true;
  } else {
    if (out_error) *out_error = strdup("ScreenCaptureKit requires macOS 13+ in this app");
    impl_->running.store(false);
    return false;
  }
}

void MacSckCapturer::Stop() {
  if (!impl_) return;
  if (!impl_->running.exchange(false)) return;
  if (@available(macOS 13.0, *)) {
    SCStream* s = impl_->stream;
    impl_->stream = nil;
    if (s) {
      dispatch_semaphore_t sem = dispatch_semaphore_create(0);
      [s stopCaptureWithCompletionHandler:^(NSError* _Nullable error) {
        (void)error;
        dispatch_semaphore_signal(sem);
      }];
      dispatch_time_t t = dispatch_time(DISPATCH_TIME_NOW, (int64_t)(2 * NSEC_PER_SEC));
      dispatch_semaphore_wait(sem, t);
    }
  }
  impl_->output = nil;
  impl_->queue = nil;
}

