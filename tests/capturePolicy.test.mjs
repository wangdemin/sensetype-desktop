import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildSpeechCaptureConstraints,
  buildSpeechFallbackConstraints,
  normalizePreferredMicDeviceId,
} from '../src/renderer/voice/capturePolicy.ts';

test('normalizes preferred mic identifiers', () => {
  assert.equal(normalizePreferredMicDeviceId(' default '), null);
  assert.equal(normalizePreferredMicDeviceId('communications'), null);
  assert.equal(normalizePreferredMicDeviceId(' mic-1 '), 'mic-1');
  assert.equal(normalizePreferredMicDeviceId(null), null);
});

test('builds fast-path windows constraints after permission is granted', () => {
  assert.deepEqual(
    buildSpeechCaptureConstraints({
      isMac: false,
      isWin: true,
      preferredMicDeviceId: null,
      permissionGranted: true,
    }),
    { audio: true },
  );
});

test('builds stable windows constraints before permission warmup', () => {
  assert.deepEqual(
    buildSpeechCaptureConstraints({
      isMac: false,
      isWin: true,
      preferredMicDeviceId: null,
      permissionGranted: null,
    }),
    {
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 16 },
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
      },
    },
  );
});

test('builds mac constraints with speech clarity defaults', () => {
  assert.deepEqual(
    buildSpeechCaptureConstraints({
      isMac: true,
      isWin: false,
      preferredMicDeviceId: 'mac-mic',
    }),
    {
      audio: {
        channelCount: { ideal: 1 },
        sampleRate: { ideal: 48000 },
        sampleSize: { ideal: 16 },
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        deviceId: { ideal: 'mac-mic' },
      },
    },
  );
});

test('builds fallback constraints with normalized preferred device', () => {
  assert.deepEqual(buildSpeechFallbackConstraints(' communications '), { audio: true });
  assert.deepEqual(buildSpeechFallbackConstraints('usb-mic'), {
    audio: {
      channelCount: { ideal: 1 },
      sampleRate: { ideal: 48000 },
      sampleSize: { ideal: 16 },
      deviceId: { ideal: 'usb-mic' },
    },
  });
});
