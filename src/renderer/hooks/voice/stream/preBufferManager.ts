import type React from 'react';

type MutableRef<T> = React.MutableRefObject<T>;

export function stopPreBuffer(args: {
  preBufferProcessorRef: MutableRef<ScriptProcessorNode | null>;
  preBufferGainRef: MutableRef<GainNode | null>;
  preBufferCtxRef: MutableRef<AudioContext | null>;
  preBufferRef: MutableRef<Float32Array | null>;
  preBufferPosRef: MutableRef<number>;
  preBufferFullRef: MutableRef<boolean>;
}) {
  const {
    preBufferProcessorRef,
    preBufferGainRef,
    preBufferCtxRef,
    preBufferRef,
    preBufferPosRef,
    preBufferFullRef,
  } = args;
  try {
    preBufferProcessorRef.current?.disconnect();
  } catch {
    //
  }
  preBufferProcessorRef.current = null;
  try {
    preBufferGainRef.current?.disconnect();
  } catch {
    //
  }
  preBufferGainRef.current = null;
  try {
    preBufferCtxRef.current?.close();
  } catch {
    //
  }
  preBufferCtxRef.current = null;
  preBufferRef.current = null;
  preBufferPosRef.current = 0;
  preBufferFullRef.current = false;
}

export function snapshotPreBuffer(args: {
  preBufferRef: MutableRef<Float32Array | null>;
  preBufferSampleRateRef: MutableRef<number>;
  preBufferFullRef: MutableRef<boolean>;
  preBufferPosRef: MutableRef<number>;
}): { pcm: Float32Array; sampleRate: number } | null {
  const { preBufferRef, preBufferSampleRateRef, preBufferFullRef, preBufferPosRef } = args;
  const buf = preBufferRef.current;
  const sr = preBufferSampleRateRef.current;
  if (!buf || !sr) return null;
  const full = preBufferFullRef.current;
  const pos = preBufferPosRef.current;
  if (!full && pos === 0) return null;
  const length = full ? buf.length : pos;
  const result = new Float32Array(length);
  if (full) {
    result.set(buf.subarray(pos, buf.length), 0);
    result.set(buf.subarray(0, pos), buf.length - pos);
  } else {
    result.set(buf.subarray(0, pos));
  }
  return { pcm: result, sampleRate: sr };
}

export function startPreBuffer(args: {
  stream: MediaStream;
  preBufferSeconds: number;
  preBufferCtxRef: MutableRef<AudioContext | null>;
  preBufferSampleRateRef: MutableRef<number>;
  preBufferRef: MutableRef<Float32Array | null>;
  preBufferPosRef: MutableRef<number>;
  preBufferFullRef: MutableRef<boolean>;
  preBufferProcessorRef: MutableRef<ScriptProcessorNode | null>;
  preBufferGainRef: MutableRef<GainNode | null>;
  stopPreBuffer: () => void;
}) {
  const {
    stream,
    preBufferSeconds,
    preBufferCtxRef,
    preBufferSampleRateRef,
    preBufferRef,
    preBufferPosRef,
    preBufferFullRef,
    preBufferProcessorRef,
    preBufferGainRef,
    stopPreBuffer,
  } = args;
  stopPreBuffer();
  try {
    const Ctx = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    preBufferCtxRef.current = ctx;
    preBufferSampleRateRef.current = ctx.sampleRate;
    const bufSize = Math.ceil(ctx.sampleRate * preBufferSeconds);
    preBufferRef.current = new Float32Array(bufSize);
    preBufferPosRef.current = 0;
    preBufferFullRef.current = false;
    const source = ctx.createMediaStreamSource(stream);
    const processor = ctx.createScriptProcessor(4096, 1, 1);
    preBufferProcessorRef.current = processor;
    processor.onaudioprocess = (e: AudioProcessingEvent) => {
      const input = e.inputBuffer.getChannelData(0);
      const b = preBufferRef.current;
      if (!b) return;
      for (let i = 0; i < input.length; i++) {
        b[preBufferPosRef.current] = input[i];
        preBufferPosRef.current = (preBufferPosRef.current + 1) % b.length;
        if (preBufferPosRef.current === 0) preBufferFullRef.current = true;
      }
    };
    const gain = ctx.createGain();
    gain.gain.value = 0;
    preBufferGainRef.current = gain;
    source.connect(processor);
    processor.connect(gain);
    gain.connect(ctx.destination);
  } catch {
    //
  }
}
