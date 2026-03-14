import type React from 'react';
import { resolveMacCaptureMicDevice } from '@/renderer/voice/micDevicePolicy';
import {
  buildSpeechCaptureConstraints,
  normalizePreferredMicDeviceId,
} from '@/renderer/voice/capturePolicy';

type MutableRef<T> = React.MutableRefObject<T>;

export function disposeWarmStream(args: {
  warmStreamExpireTimerRef: MutableRef<number | null>;
  stopPreBuffer: () => void;
  warmStreamRef: MutableRef<MediaStream | null>;
  stopStreamTracks: (s: MediaStream | null | undefined) => void;
}) {
  const { warmStreamExpireTimerRef, stopPreBuffer, warmStreamRef, stopStreamTracks } = args;
  if (warmStreamExpireTimerRef.current) {
    try {
      window.clearTimeout(warmStreamExpireTimerRef.current);
    } catch {
      //
    }
    warmStreamExpireTimerRef.current = null;
  }
  stopPreBuffer();
  if (warmStreamRef.current) {
    stopStreamTracks(warmStreamRef.current);
    warmStreamRef.current = null;
  }
}

export async function ensureWarmMicStream(args: {
  reason: 'startup' | 'after-stop' | 'manual';
  isMac: boolean;
  isWin: boolean;
  micPermissionGrantedRef: MutableRef<boolean | null>;
  warmStreamRef: MutableRef<MediaStream | null>;
  warmStreamExpireTimerRef: MutableRef<number | null>;
  warmTtlMs: number;
  preferredMicDeviceIdRef: MutableRef<string | null>;
  withTimeout: <T>(p: Promise<T>, ms: number, label: string) => Promise<T>;
  disposeWarmStream: () => void;
  startPreBuffer: (stream: MediaStream) => void;
  dlog: (...args: any[]) => void;
}) {
  const {
    reason,
    isMac,
    isWin,
    micPermissionGrantedRef,
    warmStreamRef,
    warmStreamExpireTimerRef,
    warmTtlMs,
    preferredMicDeviceIdRef,
    withTimeout,
    disposeWarmStream,
    startPreBuffer,
    dlog,
  } = args;
  if (!navigator?.mediaDevices?.getUserMedia) return;
  if (micPermissionGrantedRef.current !== true) return;

  try {
    const existing = warmStreamRef.current;
    const live =
      existing &&
      existing.getAudioTracks().some((t) => t && t.readyState === 'live' && t.enabled !== false);
    if (live) {
      if (warmStreamExpireTimerRef.current) {
        try {
          window.clearTimeout(warmStreamExpireTimerRef.current);
        } catch {
          //
        }
      }
      warmStreamExpireTimerRef.current = window.setTimeout(() => {
        disposeWarmStream();
      }, warmTtlMs);
      return;
    }
  } catch {
    //
  }

  try {
    let preferredMicDeviceId = normalizePreferredMicDeviceId(preferredMicDeviceIdRef.current);
    let warmConstraints: MediaStreamConstraints = buildSpeechCaptureConstraints({
      isMac,
      isWin,
      preferredMicDeviceId,
      permissionGranted: micPermissionGrantedRef.current,
    });
    if (isMac) {
      try {
        const resolved = await resolveMacCaptureMicDevice(preferredMicDeviceId);
        preferredMicDeviceId = normalizePreferredMicDeviceId(
          resolved?.deviceId || preferredMicDeviceId,
        );
        warmConstraints = buildSpeechCaptureConstraints({
          isMac,
          isWin,
          preferredMicDeviceId,
          permissionGranted: micPermissionGrantedRef.current,
        });
      } catch {
        warmConstraints = buildSpeechCaptureConstraints({
          isMac,
          isWin,
          preferredMicDeviceId: null,
          permissionGranted: micPermissionGrantedRef.current,
        });
      }
    }

    const s = await withTimeout(
      navigator.mediaDevices.getUserMedia(warmConstraints),
      12_000,
      `warmMic(${reason})`,
    );
    warmStreamRef.current = s;
    if (warmStreamExpireTimerRef.current) {
      try {
        window.clearTimeout(warmStreamExpireTimerRef.current);
      } catch {
        //
      }
    }
    warmStreamExpireTimerRef.current = window.setTimeout(() => {
      disposeWarmStream();
    }, warmTtlMs);

    try {
      await navigator.mediaDevices.enumerateDevices?.();
    } catch {
      //
    }

    dlog('[useVoiceRecognition] warm mic stream ready:', { reason });
    if (isWin) startPreBuffer(s);
  } catch (e) {
    dlog('[useVoiceRecognition] warm mic stream failed:', e);
  }
}
