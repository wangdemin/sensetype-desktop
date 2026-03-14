import lamejsUrl from 'lamejs/lame.min.js?url';

let lameLoading: Promise<void> | null = null;
const TARGET_MP3_KBPS = 160;

type LamejsApi = {
  Mp3Encoder: new (
    channels: number,
    sampleRate: number,
    kbps: number,
  ) => {
    encodeBuffer: (buf: Int16Array) => Uint8Array;
    flush: () => Uint8Array;
  };
};

type WindowWithWebkitAudioContext = Window & {
  webkitAudioContext?: new () => AudioContext;
};

declare global {
  interface Window {
    lamejs?: LamejsApi;
  }
}

function yieldToUi(): Promise<void> {
  // 让出事件循环，避免长循环阻塞 UI（Electron 渲染线程）
  return new Promise<void>((r) => setTimeout(r, 0));
}

function resampleFloat32Linear(
  input: Float32Array,
  inputSampleRate: number,
  outputSampleRate: number,
): Float32Array {
  if (!input.length) return new Float32Array(0);
  if (inputSampleRate === outputSampleRate) return input;
  const ratio = outputSampleRate / inputSampleRate;
  const outLen = Math.max(1, Math.floor(input.length * ratio));
  const out = new Float32Array(outLen);

  for (let i = 0; i < outLen; i++) {
    const srcPos = i / ratio;
    const i0 = Math.floor(srcPos);
    const i1 = Math.min(input.length - 1, i0 + 1);
    const t = srcPos - i0;
    out[i] = input[i0] * (1 - t) + input[i1] * t;
  }
  return out;
}

/**
 * 确保 lamejs 库已加载
 * 如果已加载则直接返回，如果正在加载则复用同一个 Promise，否则动态注入 script
 */
export async function ensureLamejsLoaded(): Promise<void> {
  // already loaded
  if (typeof window.lamejs !== 'undefined') return;
  if (lameLoading) return lameLoading;

  lameLoading = new Promise<void>((resolve, reject) => {
    try {
      const existing = document.querySelector<HTMLScriptElement>('script[data-sensetype="lamejs"]');
      if (existing) {
        // if it exists but not loaded yet, wait a tick and re-check
        setTimeout(() => {
          if (typeof window.lamejs !== 'undefined') resolve();
          else reject(new Error('lamejs 加载失败'));
        }, 0);
        return;
      }

      const script = document.createElement('script');
      script.dataset.sensetype = 'lamejs';
      script.src = new URL(lamejsUrl, window.location.href).toString();
      script.async = true;
      script.onload = () => {
        if (typeof window.lamejs !== 'undefined') resolve();
        else reject(new Error('lamejs 加载失败'));
      };
      script.onerror = () => reject(new Error('lamejs 加载失败：脚本加载错误'));
      document.head.appendChild(script);
    } catch (e: unknown) {
      reject(e instanceof Error ? e : new Error(String(e)));
    }
  }).finally(() => {
    lameLoading = null;
  });

  return lameLoading;
}

export type ConvertToMp3Options = {
  /**
   * 预缓冲 PCM 音频（用于解决录音启动延迟导致的"前面丢字"问题）。
   * 如果提供，会在解码后的音频前面拼接上这段 PCM 数据。
   */
  preBufferPcm?: { pcm: Float32Array; sampleRate: number };
};

/**
 * 将 WebM/Opus Blob 转换为 MP3 Blob（基于 lamejs）
 */
export async function convertToMp3(
  audioBlob: Blob,
  options: ConvertToMp3Options = {},
): Promise<Blob> {
  await ensureLamejsLoaded();

  const lamejs = window.lamejs;
  if (!lamejs?.Mp3Encoder) throw new Error('lamejs 未就绪');

  const AudioCtx =
    window.AudioContext || (window as WindowWithWebkitAudioContext).webkitAudioContext;
  if (!AudioCtx) throw new Error('AudioContext not supported');

  const audioContext = new AudioCtx();
  try {
    const arrayBuffer = await audioBlob.arrayBuffer();
    const audioBuffer = await audioContext.decodeAudioData(arrayBuffer.slice(0));
    const sampleRate = audioBuffer.sampleRate;

    // 获取第一个声道的数据
    let monoData = audioBuffer.getChannelData(0);

    // 如果是多声道，混合为单声道（取平均值）
    if (audioBuffer.numberOfChannels > 1) {
      const ch2 = audioBuffer.getChannelData(1);
      const mixed = new Float32Array(monoData.length);
      for (let i = 0; i < mixed.length; i++) {
        mixed[i] = (monoData[i] + ch2[i]) / 2;
        if (i % 200000 === 0) await yieldToUi();
      }
      monoData = mixed;
    }

    // 预缓冲拼接：将热键按下前捕获的 PCM 数据拼接到录音音频前面，避免丢字
    if (options.preBufferPcm?.pcm?.length) {
      try {
        let prePcm = options.preBufferPcm.pcm;
        const preSr = options.preBufferPcm.sampleRate;
        // 采样率不一致时重采样
        if (preSr !== sampleRate) {
          prePcm = resampleFloat32Linear(prePcm, preSr, sampleRate);
        }
        const combined = new Float32Array(prePcm.length + monoData.length);
        combined.set(prePcm, 0);
        combined.set(monoData, prePcm.length);
        monoData = combined;
      } catch (e) {
        console.warn('[convertToMp3] 预缓冲拼接失败，忽略预缓冲:', e);
      }
    }

    // Float32 (-1..1) -> Int16 PCM
    const pcm = new Int16Array(monoData.length);
    for (let i = 0; i < monoData.length; i++) {
      const s = Math.max(-1, Math.min(1, monoData[i]));
      pcm[i] = s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
      if (i % 200000 === 0) await yieldToUi();
    }

    // 单声道，采样率，128kbps
    const mp3encoder = new lamejs.Mp3Encoder(1, sampleRate, TARGET_MP3_KBPS);
    const sampleBlockSize = 1152;
    const mp3Chunks: Uint8Array[] = [];

    let encodedChunks = 0;
    for (let i = 0; i < pcm.length; i += sampleBlockSize) {
      const chunk = pcm.subarray(i, i + sampleBlockSize);
      const mp3buf: Uint8Array = mp3encoder.encodeBuffer(chunk);
      if (mp3buf.length > 0) {
        mp3Chunks.push(mp3buf);
        encodedChunks++;
      }
      if (encodedChunks % 200 === 0) await yieldToUi();
    }

    const mp3buf: Uint8Array = mp3encoder.flush();
    if (mp3buf.length > 0) mp3Chunks.push(mp3buf);

    // TS 类型上 ArrayBufferView 需要是 ArrayBuffer（不是 ArrayBufferLike/SharedArrayBuffer），这里显式复制成 ArrayBuffer
    const parts: BlobPart[] = mp3Chunks.map((u) => {
      const ab = new ArrayBuffer(u.byteLength);
      new Uint8Array(ab).set(u);
      return ab;
    });
    return new Blob(parts, { type: 'audio/mpeg' });
  } finally {
    audioContext.close().catch(() => undefined);
  }
}
