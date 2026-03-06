import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

type IpcRendererLike = {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
};

export type MicrophoneDevice = {
  deviceId: string;
  label: string;
};

export function useMicrophoneTest(params: {
  barsCount: number;
  enabled: boolean;
  ipcRenderer?: IpcRendererLike | null;
}) {
  const { barsCount, enabled, ipcRenderer } = params;

  const [activeBars, setActiveBars] = useState(0);
  const [microphones, setMicrophones] = useState<MicrophoneDevice[]>([]);
  const [preferredMicDeviceId, setPreferredMicDeviceId] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const rafRef = useRef<number | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);

  const stop = useCallback(() => {
    try {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    } catch {
      // ignore
    }
    rafRef.current = null;
    try {
      streamRef.current?.getTracks?.().forEach((t) => t.stop());
    } catch {
      // ignore
    }
    streamRef.current = null;
    try {
      audioCtxRef.current?.close?.();
    } catch {
      // ignore
    }
    audioCtxRef.current = null;
    analyserRef.current = null;
  }, []);

  const refreshMicrophones = useCallback(async () => {
    try {
      if (!navigator?.mediaDevices?.enumerateDevices) {
        setMicrophones([]);
        return;
      }
      const devices = await navigator.mediaDevices.enumerateDevices();
      const mics = devices
        .filter((d) => d.kind === 'audioinput')
        .map((d, idx) => ({
          deviceId: d.deviceId,
          label: d.label || `麦克风 ${idx + 1}`,
        }))
        .filter((d, i, arr) => arr.findIndex((x) => x.deviceId === d.deviceId) === i);
      setMicrophones(mics);
    } catch {
      setMicrophones([]);
    }
  }, []);

  const micOptions = useMemo(
    () => [
      { value: '__default__', label: '系统默认' },
      ...microphones.map((d) => ({ value: d.deviceId, label: d.label })),
    ],
    [microphones],
  );

  const startMicTest = useCallback(
    async (deviceId: string | null) => {
      stop();
      setActiveBars(0);

      if (!navigator?.mediaDevices?.getUserMedia) return;

      const constraints: MediaStreamConstraints =
        deviceId && deviceId !== '__default__'
          ? { audio: { deviceId: { ideal: deviceId } } }
          : { audio: true };

      try {
        const stream = await navigator.mediaDevices.getUserMedia(constraints);
        streamRef.current = stream;

        const AudioCtx =
          typeof window.AudioContext !== 'undefined'
            ? window.AudioContext
            : (window as unknown as { webkitAudioContext?: typeof AudioContext })
                ?.webkitAudioContext;
        if (!AudioCtx) return;

        const ctx = new AudioCtx();
        audioCtxRef.current = ctx;
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 2048;
        analyser.smoothingTimeConstant = 0.8;
        analyserRef.current = analyser;

        const source = ctx.createMediaStreamSource(stream);
        source.connect(analyser);

        const data = new Uint8Array(analyser.fftSize);
        let lastBars = -1;
        const tick = () => {
          const a = analyserRef.current;
          if (!a) return;

          a.getByteTimeDomainData(data);
          // RMS 归一化到 0..1
          let sum = 0;
          for (let i = 0; i < data.length; i++) {
            const v = (data[i] - 128) / 128;
            sum += v * v;
          }
          const rms = Math.sqrt(sum / data.length);
          // 经验映射：让人声更容易点亮
          const normalized = Math.min(1, Math.max(0, (rms - 0.02) / 0.18));
          const bars = Math.max(0, Math.min(barsCount, Math.round(normalized * barsCount)));
          if (bars !== lastBars) {
            lastBars = bars;
            setActiveBars(bars);
          }
          rafRef.current = requestAnimationFrame(tick);
        };
        rafRef.current = requestAnimationFrame(tick);
      } catch {
        // ignore: 权限/设备不可用时保持 0
        setActiveBars(0);
      }
    },
    [barsCount, stop],
  );

  // 初始化：读取首选麦克风 + 枚举设备
  useEffect(() => {
    let stopped = false;
    const init = async () => {
      try {
        if (ipcRenderer?.invoke) {
          const raw = await ipcRenderer.invoke('settings-get-preferred-mic');
          const v = (raw || {}) as { deviceId?: unknown };
          const d = typeof v.deviceId === 'string' ? v.deviceId.trim() : '';
          const next = d ? d : null;
          if (!stopped) setPreferredMicDeviceId(next);
        }
      } catch {
        // ignore
      }
      await refreshMicrophones();
    };
    void init();
    return () => {
      stopped = true;
    };
  }, [ipcRenderer, refreshMicrophones]);

  // 设备变化时重启测试（enabled 时）
  useEffect(() => {
    if (!enabled) return;
    void startMicTest(preferredMicDeviceId);
    return () => {
      stop();
    };
  }, [enabled, preferredMicDeviceId, startMicTest, stop]);

  const onChangePreferredMic = useCallback(
    (value: string) => {
      const next = value === '__default__' ? null : value;
      setPreferredMicDeviceId(next);
      if (ipcRenderer?.invoke) {
        void ipcRenderer
          .invoke('settings-set-preferred-mic', { deviceId: next })
          .catch(() => undefined);
      }
      // 选择后顺手刷新一次列表（插拔设备/权限变化时更稳）
      void refreshMicrophones();
    },
    [ipcRenderer, refreshMicrophones],
  );

  return {
    activeBars,
    microphones,
    micOptions,
    preferredMicDeviceId,
    setPreferredMicDeviceId,
    refreshMicrophones,
    onChangePreferredMic,
    stop,
  };
}
