import { createVoiceInputWsClient, DEFAULT_VOICE_INPUT_WS_URL } from '@/axios/ws';

function floatToInt16(x: number): number {
  const s = Math.max(-1, Math.min(1, x));
  return s < 0 ? (s * 0x8000) | 0 : (s * 0x7fff) | 0;
}

function float32ToPcm16Chunk(input: Float32Array, inputSampleRate: number): Int16Array {
  if (!input.length) return new Int16Array(0);
  const targetSampleRate = 16000;
  if (!inputSampleRate || inputSampleRate <= 0) return new Int16Array(0);

  if (inputSampleRate === targetSampleRate) {
    const out = new Int16Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = floatToInt16(input[i] ?? 0);
    return out;
  }

  const ratio = inputSampleRate / targetSampleRate;
  const outLen = Math.max(1, Math.floor(input.length / ratio));
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcPos = i * ratio;
    const idx = Math.floor(srcPos);
    const frac = srcPos - idx;
    const s0 = input[idx] ?? 0;
    const s1 = input[Math.min(idx + 1, input.length - 1)] ?? s0;
    const sample = s0 + (s1 - s0) * frac;
    out[i] = floatToInt16(sample);
  }
  return out;
}

export async function setupLongRecordingWsOnStart(ctx: any): Promise<void> {
  try {
    const wsClient = createVoiceInputWsClient({
      url: DEFAULT_VOICE_INPUT_WS_URL,
      summaryIntervalS: 0,
      onResultFinal: (data) => {
        const hasTranslationField = Object.prototype.hasOwnProperty.call(data || {}, 'translation');
        const text = String(hasTranslationField ? data?.translation ?? '' : data?.text ?? '').trim();
        if (!text) return;
        const merged = ctx.voiceWsResultTextRef.current ? `${ctx.voiceWsResultTextRef.current}\n${text}` : text;
        ctx.voiceWsResultTextRef.current = merged;
        // 仅用于悬浮波动条实时预览，限制长度避免高频 IPC payload 过大。
        const previewTail = merged.length > 500 ? `...${merged.slice(-500)}` : merged;
        try {
          ctx.setApiResult(merged);
        } catch {
          // ignore
        }
        try {
          ctx.setIndicatorPreviewText?.(previewTail);
        } catch {
          // ignore
        }
      },
      onTaskFailed: (message) => {
        ctx.voiceWsErrorRef.current = String(message || '语音输入任务失败');
      },
      onWsError: (message) => {
        ctx.voiceWsErrorRef.current = String(message || '语音输入 WS 连接失败');
      },
    });
    ctx.voiceWsClientRef.current = wsClient;
    ctx.voiceWsConnectPromiseRef.current = wsClient.connectAndStart().catch((e: any) => {
      const msg = String(e?.message || e || '语音输入 WS 连接失败');
      ctx.voiceWsErrorRef.current = msg;
    });

    const preBufferPcm = ctx.preBufferSnapshotRef.current;
    if (preBufferPcm?.pcm?.length && preBufferPcm.sampleRate > 0) {
      const preChunk = float32ToPcm16Chunk(preBufferPcm.pcm, preBufferPcm.sampleRate);
      if (preChunk.length) wsClient.sendAudio(preChunk);
    }

    const WsAudioContext = window.AudioContext || (window as any).webkitAudioContext;
    if (!WsAudioContext) throw new Error('AudioContext not supported');
    const wsAudioCtx: AudioContext = new WsAudioContext();
    if (wsAudioCtx.state === 'suspended') {
      try {
        await wsAudioCtx.resume();
      } catch {
        // ignore
      }
    }

    const wsSource = wsAudioCtx.createMediaStreamSource(ctx.streamRef.current);
    const wsProcessor = wsAudioCtx.createScriptProcessor(4096, 1, 1);
    const wsGain = wsAudioCtx.createGain();
    wsGain.gain.value = 0;

    wsProcessor.onaudioprocess = (event: AudioProcessingEvent) => {
      if (!ctx.desiredRecordingRef.current || ctx.cancelRequestedRef.current) return;
      const input = event.inputBuffer.getChannelData(0);
      if (!input?.length) return;
      const copy = new Float32Array(input.length);
      copy.set(input);
      const pcm16 = float32ToPcm16Chunk(copy, wsAudioCtx.sampleRate);
      if (!pcm16.length) return;
      wsClient.sendAudio(pcm16);
    };

    wsSource.connect(wsProcessor);
    wsProcessor.connect(wsGain);
    wsGain.connect(wsAudioCtx.destination);

    ctx.voiceWsAudioCtxRef.current = wsAudioCtx;
    ctx.voiceWsSourceRef.current = wsSource;
    ctx.voiceWsProcessorRef.current = wsProcessor;
    ctx.voiceWsGainRef.current = wsGain;
  } catch (wsErr: any) {
    // WS 路由必须走 WS：初始化失败直接终止本次录音，避免回退到 SSE 造成链路混用。
    const msg = String(wsErr?.message || wsErr || 'unknown');
    console.error('[useVoiceRecognition] WS 路由初始化失败，终止本次录音:', msg);
    ctx.voiceWsErrorRef.current = msg;
    try {
      ctx.closeVoiceWsSession?.();
    } catch {
      // ignore
    }
    throw new Error(`长录音服务不可用：${msg}`);
  }
}

export async function finishLongRecordingWsOnStop(ctx: any): Promise<string> {
  const wsClient = ctx.voiceWsClientRef.current;
  if (!wsClient) throw new Error(ctx.voiceWsErrorRef.current || '长录音服务未初始化');

  ctx.asrAbortControllerRef.current = null;
  if (ctx.voiceWsConnectPromiseRef.current) {
    await Promise.race([
      ctx.voiceWsConnectPromiseRef.current,
      new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error('等待语音输入服务连接超时')), 8000);
      }),
    ]);
  }
  if (ctx.abortAllRef.current) {
    throw new DOMException('aborted', 'AbortError');
  }
  if (!wsClient.isReady()) {
    throw new Error(ctx.voiceWsErrorRef.current || '语音输入 WS 未就绪');
  }

  await wsClient.finishTask();
  const result = String(ctx.voiceWsResultTextRef.current || '').trim();
  try {
    wsClient.close();
  } catch {
    // ignore
  }
  ctx.voiceWsClientRef.current = null;
  ctx.voiceWsConnectPromiseRef.current = null;
  return result;
}

