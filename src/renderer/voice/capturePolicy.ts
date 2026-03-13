export const CLEAR_SPEECH_AUDIO_IDEALS = {
  channelCount: { ideal: 1 },
  sampleRate: { ideal: 48_000 },
  sampleSize: { ideal: 16 },
} as const;

const MAC_DSP_CONSTRAINTS = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
} as const;

const WIN_SAFE_DSP_CONSTRAINTS = {
  echoCancellation: false,
  noiseSuppression: false,
  autoGainControl: false,
} as const;

export function normalizePreferredMicDeviceId(deviceId: string | null | undefined): string | null {
  const value = typeof deviceId === 'string' ? deviceId.trim() : '';
  if (!value || value === 'default' || value === 'communications') return null;
  return value;
}

export function buildSpeechCaptureConstraints(args: {
  isMac: boolean;
  isWin: boolean;
  preferredMicDeviceId?: string | null;
  permissionGranted?: boolean | null;
}): MediaStreamConstraints {
  const preferredMicDeviceId = normalizePreferredMicDeviceId(args.preferredMicDeviceId);

  if (args.isWin) {
    if (preferredMicDeviceId) {
      return {
        audio: {
          ...CLEAR_SPEECH_AUDIO_IDEALS,
          deviceId: { ideal: preferredMicDeviceId },
        },
      };
    }
    if (args.permissionGranted === true) {
      // Win 冷启动优先速度：权限已确认时用最简单约束，降低 getUserMedia 卡住概率。
      return { audio: true };
    }
    return {
      audio: {
        ...CLEAR_SPEECH_AUDIO_IDEALS,
        ...WIN_SAFE_DSP_CONSTRAINTS,
      },
    };
  }

  if (args.isMac) {
    return {
      audio: preferredMicDeviceId
        ? {
            ...CLEAR_SPEECH_AUDIO_IDEALS,
            ...MAC_DSP_CONSTRAINTS,
            deviceId: { ideal: preferredMicDeviceId },
          }
        : {
            ...CLEAR_SPEECH_AUDIO_IDEALS,
            ...MAC_DSP_CONSTRAINTS,
          },
    };
  }

  return {
    audio: preferredMicDeviceId
      ? {
          ...CLEAR_SPEECH_AUDIO_IDEALS,
          deviceId: { ideal: preferredMicDeviceId },
        }
      : {
          ...CLEAR_SPEECH_AUDIO_IDEALS,
        },
  };
}

export function buildSpeechFallbackConstraints(
  preferredMicDeviceId?: string | null,
): MediaStreamConstraints {
  const normalized = normalizePreferredMicDeviceId(preferredMicDeviceId);
  if (!normalized) {
    return { audio: true };
  }
  return {
    audio: {
      ...CLEAR_SPEECH_AUDIO_IDEALS,
      deviceId: { ideal: normalized },
    },
  };
}
