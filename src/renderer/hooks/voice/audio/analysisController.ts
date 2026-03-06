import type React from 'react';
import type { VoiceIndicatorStatus } from '@/renderer/components/VoiceIndicator';

type MutableRef<T> = React.MutableRefObject<T>;

export type StopAudioAnalysisArgs = {
  analyserTimerRef: MutableRef<ReturnType<typeof setInterval> | null>;
  analyserRef: MutableRef<AnalyserNode | null>;
  analyserGainRef: MutableRef<GainNode | null>;
  audioContextRef: MutableRef<AudioContext | null>;
  smoothedBarsRef: MutableRef<number[]>;
  smoothRmsRef: MutableRef<number>;
  speakingHoldRef: MutableRef<number>;
  lastAnalyserAtRef: MutableRef<number>;
  setIndicatorVolumes: (v: number[] | null) => void;
  setIndicatorStatus: (v: VoiceIndicatorStatus) => void;
};

export function stopAudioAnalysisImpl(args: StopAudioAnalysisArgs) {
  const {
    analyserTimerRef,
    analyserRef,
    analyserGainRef,
    audioContextRef,
    smoothedBarsRef,
    smoothRmsRef,
    speakingHoldRef,
    lastAnalyserAtRef,
    setIndicatorVolumes,
    setIndicatorStatus,
  } = args;

  if (analyserTimerRef.current) {
    clearInterval(analyserTimerRef.current);
    analyserTimerRef.current = null;
  }
  analyserRef.current = null;
  if (analyserGainRef.current) {
    try {
      analyserGainRef.current.disconnect();
    } catch {
      //
    }
    analyserGainRef.current = null;
  }
  if (audioContextRef.current) {
    audioContextRef.current.close().catch(() => undefined);
    audioContextRef.current = null;
  }
  smoothedBarsRef.current = new Array(12).fill(0);
  smoothRmsRef.current = 0;
  speakingHoldRef.current = 0;
  lastAnalyserAtRef.current = 0;
  setIndicatorVolumes(null);
  setIndicatorStatus('silent');
}

export type StartAudioAnalysisArgs = StopAudioAnalysisArgs & {
  stream: MediaStream;
  dlog: (...args: any[]) => void;
  stopAudioAnalysis: () => void;
};

export async function startAudioAnalysisImpl(args: StartAudioAnalysisArgs) {
  const {
    stream,
    dlog,
    stopAudioAnalysis,
    analyserRef,
    analyserTimerRef,
    analyserGainRef,
    audioContextRef,
    smoothedBarsRef,
    smoothRmsRef,
    speakingHoldRef,
    setIndicatorVolumes,
    setIndicatorStatus,
  } = args;

  try {
    stopAudioAnalysis();
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) {
      setIndicatorVolumes(new Array(12).fill(0.3));
      setIndicatorStatus('speaking');
      return;
    }

    const ctx: AudioContext = new Ctx();
    audioContextRef.current = ctx;
    dlog('[useVoiceRecognition] AudioContext 创建，初始状态:', ctx.state);

    try {
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      ctx.onstatechange = () => {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
      };
    } catch {
      //
    }

    const audioTracks = stream.getAudioTracks();
    if (audioTracks.length === 0) return;

    const source = ctx.createMediaStreamSource(stream);
    const analyser = ctx.createAnalyser();
    analyser.fftSize = 2048;
    analyser.smoothingTimeConstant = 0.0;
    source.connect(analyser);
    analyserRef.current = analyser;

    try {
      const gain = ctx.createGain();
      gain.gain.value = 0;
      analyser.connect(gain);
      gain.connect(ctx.destination);
      analyserGainRef.current = gain;
    } catch {
      //
    }

    const barCount = 12;
    const nextBars = new Array<number>(barCount).fill(0);
    const freq = new Uint8Array(analyser.frequencyBinCount);
    const time = new Uint8Array(analyser.fftSize);
    const halfCount = Math.floor(barCount / 2) + 1;
    const edges = (() => {
      const n = analyser.frequencyBinCount;
      const minHz = 80;
      const maxHz = 8000;
      const sr = ctx.sampleRate;
      const hzToBin = (hz: number) => Math.max(0, Math.min(n - 1, Math.floor((hz / (sr / 2)) * n)));
      const minBin = hzToBin(minHz);
      const maxBin = hzToBin(maxHz);
      const out: number[] = [];
      for (let i = 0; i <= halfCount; i++) {
        const t = i / halfCount;
        const bin = Math.round(minBin * Math.pow(maxBin / Math.max(1, minBin), t));
        out.push(Math.max(minBin, Math.min(maxBin, bin)));
      }
      for (let i = 1; i < out.length; i++) if (out[i] < out[i - 1]) out[i] = out[i - 1];
      return out;
    })();

    const loop = () => {
      analyser.getByteFrequencyData(freq);
      analyser.getByteTimeDomainData(time);
      let sum = 0;
      for (let i = 0; i < time.length; i++) {
        const v = (time[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / time.length);
      const prevRms = smoothRmsRef.current;
      const rmsA = rms > prevRms ? 0.55 : 0.12;
      const smoothRms = prevRms + (rms - prevRms) * rmsA;
      smoothRmsRef.current = smoothRms;

      const SPEAK_ON = 0.03;
      const hold = speakingHoldRef.current;
      let nextStatus: VoiceIndicatorStatus = 'silent';
      if (smoothRms > SPEAK_ON) {
        speakingHoldRef.current = 20;
        nextStatus = 'speaking';
      } else if (hold > 0) {
        speakingHoldRef.current = hold - 1;
        nextStatus = 'speaking';
      } else {
        speakingHoldRef.current = 0;
        nextStatus = 'silent';
      }

      nextBars.fill(0);
      const mid = (barCount - 1) / 2;
      let sumF = 0;
      let sumIx = 0;
      for (let i = 0; i < freq.length; i++) {
        const v = freq[i] || 0;
        sumF += v;
        sumIx += i * v;
      }
      const centroidBin = sumF > 0 ? sumIx / sumF : freq.length / 2;
      const centroidNorm = (centroidBin / Math.max(1, freq.length - 1)) * 2 - 1;
      const peakShift = centroidNorm * 0.6;
      const sigma = 2.8 - 0.35 * Math.min(1, Math.abs(centroidNorm));
      const bandEnergy = new Array<number>(halfCount).fill(0);
      for (let b = 0; b < halfCount; b++) {
        const start = edges[b];
        const end = Math.max(edges[b + 1], start + 1);
        let acc = 0;
        for (let i = start; i < end; i++) acc += freq[i] || 0;
        const avg = acc / (end - start);
        const gate = 18;
        bandEnergy[b] = Math.pow(Math.max(0, avg - gate) / (255 - gate), 0.6);
      }

      const rmsBoost = Math.max(0, Math.min(1, smoothRms * 6));
      for (let i = 0; i < barCount; i++) {
        const dist = Math.abs(i - (mid + peakShift));
        const bandIdx = Math.min(
          halfCount - 1,
          Math.max(0, Math.round((dist / Math.max(1e-6, mid)) * (halfCount - 1))),
        );
        const base = bandEnergy[bandIdx] ?? 0;
        const mountain = Math.exp(-(dist * dist) / (2 * sigma * sigma));
        const fused = base * 0.7 + rmsBoost * 0.3;
        const floor = 0.18;
        const shaped = floor + (1 - floor) * fused;
        const mountainMin = 0.55;
        const adjustedMountain = mountainMin + (1 - mountainMin) * mountain;
        nextBars[i] = Math.max(0, Math.min(1, shaped * (0.55 + 0.45 * adjustedMountain)));
      }

      const prev = smoothedBarsRef.current;
      for (let i = 0; i < barCount; i++) {
        const target = nextBars[i];
        const cur = prev[i] ?? 0;
        const a = target > cur ? 0.6 : 0.18;
        prev[i] = cur + (target - cur) * a;
      }
      smoothedBarsRef.current = prev;
      setIndicatorVolumes([...prev]);
      setIndicatorStatus(nextStatus);
    };

    loop();
    analyserTimerRef.current = setInterval(loop, 33);
  } catch {
    try {
      setIndicatorVolumes(new Array(12).fill(0.2));
      setIndicatorStatus('speaking');
    } catch {
      //
    }
  }
}
