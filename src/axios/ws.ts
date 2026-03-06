import config from '@/config';
import { getToken } from '@/utils/auth';

const VOICE_INPUT_WS_PATH = '/v1/ws/audio/voice_input';
const TARGET_SAMPLE_RATE = 16000;
const PREFERRED_LANGUAGE_STORAGE_KEY = 'preferred_language_variant';
const TARGET_LANGUAGE_CODES = new Set([
  'en',
  'zh',
  'ar',
  'de',
  'ru',
  'fr',
  'ko',
  'nl',
  'ms',
  'pt',
  'ja',
  'th',
  'tr',
  'ur',
  'es',
  'id',
  'it',
  'yue',
  'vi',
]);

const LANGUAGE_VARIANT_TO_CODE: Record<string, string> = {
  english: 'en',
  chinese: 'zh',
  arabic: 'ar',
  german: 'de',
  russian: 'ru',
  french: 'fr',
  korean: 'ko',
  dutch: 'nl',
  malay: 'ms',
  portuguese: 'pt',
  japanese: 'ja',
  thai: 'th',
  turkish: 'tr',
  urdu: 'ur',
  spanish: 'es',
  indonesian: 'id',
  italian: 'it',
  cantonese: 'yue',
  vietnamese: 'vi',
};

export const DEFAULT_VOICE_INPUT_WS_URL = `${config.wsBaseUrl}${VOICE_INPUT_WS_PATH}`;

type WsBaseResp = {
  status_code?: number;
  status_msg?: string;
};

export type VoiceInputWsWord = {
  word: string;
  start_time: number;
  end_time: number;
};

export type VoiceInputResultFinalTimings = {
  total_s?: number;
  convert_s?: number;
  asr_s?: number;
  translate_s?: number;
  audio_duration_ms?: number;
};

export type VoiceInputResultFinalData = {
  text?: string;
  translation?: string;
  is_final?: boolean;
  segment_id?: number;
  timestamp_start?: number;
  timestamp_end?: number;
  words?: VoiceInputWsWord[];
  timings?: VoiceInputResultFinalTimings;
};

export type VoiceInputResultSummaryData = {
  sentences?: Array<{ text?: string; translation?: string }>;
  summary_index?: number;
  is_final?: boolean;
  // 兼容不同后端返回结构
  title?: string;
  content?: string;
  sections?: Array<{ heading?: string; items?: string[] }>;
};

type WsServerMessage =
  | { event: 'connected_success'; session_id?: string; base_resp?: WsBaseResp }
  | { event: 'task_started'; session_id?: string; base_resp?: WsBaseResp }
  | {
      event: 'result_final';
      session_id?: string;
      data?: VoiceInputResultFinalData;
      base_resp?: WsBaseResp;
    }
  | {
      event: 'result_summary';
      session_id?: string;
      data?: VoiceInputResultSummaryData;
      base_resp?: WsBaseResp;
    }
  | { event: 'task_finished'; session_id?: string; base_resp?: WsBaseResp }
  | { event: 'task_failed'; session_id?: string; base_resp?: WsBaseResp }
  | { event: string; [k: string]: unknown };

export type VoiceInputWsClientOptions = {
  url?: string;
  summaryIntervalS?: number;
  targetLanguage?: string;
  hotWords?: string[];
  abbreviations?: Record<string, string>;
  maxQueuedPcmMs?: number;
  onTaskStarted?: () => void;
  onResultFinal?: (data: VoiceInputResultFinalData) => void;
  onResultSummary?: (data: VoiceInputResultSummaryData) => void;
  onTaskFailed?: (message: string) => void;
  onWsError?: (message: string) => void;
};

export type VoiceInputWsClient = {
  connectAndStart: () => Promise<void>;
  sendAudio: (pcm16: Int16Array) => void;
  finishTask: (timeoutMs?: number) => Promise<void>;
  close: () => void;
  isReady: () => boolean;
};

function safeJsonParse(input: string): WsServerMessage | null {
  try {
    return JSON.parse(input) as WsServerMessage;
  } catch {
    return null;
  }
}

function appendTokenToWsUrl(rawUrl: string): string {
  const token = String(getToken() || '').trim();
  if (!token) return rawUrl;
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set('token', token);
    return parsed.toString();
  } catch {
    const separator = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${separator}token=${encodeURIComponent(token)}`;
  }
}

function safeGetPreferredLanguageVariant(): string | null {
  try {
    const v = localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY);
    if (!v) return null;
    const s = String(v).trim();
    if (!s || s === 'None') return null;
    return s;
  } catch {
    return null;
  }
}

function toTargetLanguageCode(input?: string | null): string {
  const raw = String(input || '').trim();
  if (!raw || raw === 'None') return '';
  const lower = raw.toLowerCase();

  // 先兼容设置页业务枚举（English/Chinese/...）
  if (LANGUAGE_VARIANT_TO_CODE[lower]) return LANGUAGE_VARIANT_TO_CODE[lower];
  // 再兼容已经是 code 的调用方（en/zh/...）
  if (TARGET_LANGUAGE_CODES.has(lower)) return lower;
  // 兼容 BCP-47 变体（en-US/zh-CN/...），统一折叠到基础 code
  const base = lower.split('-')[0] || '';
  if (TARGET_LANGUAGE_CODES.has(base)) return base;
  return '';
}

function resolveTargetLanguage(targetLanguage?: string): string {
  const explicit = toTargetLanguageCode(targetLanguage);
  if (explicit) return explicit;
  return toTargetLanguageCode(safeGetPreferredLanguageVariant());
}

export function createVoiceInputWsClient(opts: VoiceInputWsClientOptions = {}): VoiceInputWsClient {
  const url = appendTokenToWsUrl(opts.url || DEFAULT_VOICE_INPUT_WS_URL);
  const maxQueuedSamples = Math.max(
    TARGET_SAMPLE_RATE,
    Math.floor((TARGET_SAMPLE_RATE * (opts.maxQueuedPcmMs ?? 5000)) / 1000),
  );

  let ws: WebSocket | null = null;
  let ready = false;
  let started = false;
  let finished = false;

  let startResolve: (() => void) | null = null;
  let startReject: ((reason?: unknown) => void) | null = null;
  let startPromise: Promise<void> | null = null;

  let finishResolve: (() => void) | null = null;
  let finishReject: ((reason?: unknown) => void) | null = null;

  let pendingAudioQueue: Int16Array[] = [];
  let pendingSamples = 0;

  const resetQueue = () => {
    pendingAudioQueue = [];
    pendingSamples = 0;
  };

  const rejectStartOnce = (reason: unknown) => {
    if (!startReject) return;
    startReject(reason);
    startReject = null;
    startResolve = null;
    startPromise = null;
  };

  const resolveStartOnce = () => {
    if (!startResolve) return;
    startResolve();
    startResolve = null;
    startReject = null;
    startPromise = null;
  };

  const rejectFinishOnce = (reason: unknown) => {
    if (!finishReject) return;
    finishReject(reason);
    finishReject = null;
    finishResolve = null;
  };

  const resolveFinishOnce = () => {
    if (!finishResolve) return;
    finishResolve();
    finishResolve = null;
    finishReject = null;
  };

  const sendPackedAudio = (pcm16: Int16Array) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    const packed = new Int16Array(pcm16.length);
    packed.set(pcm16);
    ws.send(packed.buffer);
  };

  const pushAudioToQueue = (pcm16: Int16Array) => {
    if (!pcm16.length) return;
    pendingAudioQueue.push(pcm16);
    pendingSamples += pcm16.length;
    while (pendingSamples > maxQueuedSamples && pendingAudioQueue.length) {
      const dropped = pendingAudioQueue.shift();
      pendingSamples -= dropped?.length ?? 0;
    }
  };

  const flushQueuedAudio = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    for (const chunk of pendingAudioQueue) sendPackedAudio(chunk);
    resetQueue();
  };

  const close = () => {
    ready = false;
    started = false;
    finished = true;
    try {
      ws?.close();
    } catch {
      // ignore
    }
    ws = null;
    rejectStartOnce(new Error('语音输入 WS 已关闭'));
    rejectFinishOnce(new Error('语音输入 WS 已关闭'));
    resetQueue();
  };

  const sendTaskStart = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) throw new Error('WebSocket 未连接');
    const payload = {
      event: 'task_start',
      model: 'sense-asr-deepthink-1.1',
      audio_setting: {
        sample_rate: TARGET_SAMPLE_RATE,
        format: 'pcm',
        channel: 1,
      },
      vad_setting: {
        silence_duration: 500,
        min_speech_duration: 300,
        soft_max_duration: 15000,
        hard_max_duration: 30000,
        soft_silence_duration: 300,
        threshold: 0.7,
      },
      voice_input_setting: {
        target_language: resolveTargetLanguage(opts.targetLanguage),
        hot_words: Array.isArray(opts.hotWords) ? opts.hotWords : [],
        abbreviations: opts.abbreviations || {},
        summary_interval_s: opts.summaryIntervalS ?? 30,
      },
    };
    ws.send(JSON.stringify(payload));
  };

  const connectAndStart = async () => {
    if (started && ready) return;
    if (startPromise) return startPromise;

    if (ws && ws.readyState === WebSocket.OPEN) {
      startPromise = new Promise<void>((resolve, reject) => {
        startResolve = resolve;
        startReject = reject;
      });
      // 允许 task_failed 后在同一连接重发 task_start。
      if (!started) {
        try {
          sendTaskStart();
        } catch (e) {
          rejectStartOnce(e);
        }
      }
      return startPromise;
    }

    if (ws && ws.readyState === WebSocket.CONNECTING) {
      startPromise = new Promise<void>((resolve, reject) => {
        startResolve = resolve;
        startReject = reject;
      });
      return startPromise;
    }

    finished = false;
    ws = new WebSocket(url);

    ws.onopen = () => {
      // wait connected_success before sending task_start
    };

    ws.onerror = () => {
      ready = false;
      const msg = '语音输入 WS 连接失败';
      opts.onWsError?.(msg);
      rejectStartOnce(new Error(msg));
      rejectFinishOnce(new Error(msg));
    };

    ws.onclose = () => {
      const wasStarted = started;
      ready = false;
      started = false;
      if (wasStarted && !finished) rejectFinishOnce(new Error('语音输入 WS 连接已关闭'));
      if (!wasStarted) rejectStartOnce(new Error('语音输入 WS 连接已关闭'));
    };

    ws.onmessage = (evt: MessageEvent) => {
      if (typeof evt.data !== 'string') return;
      const msg = safeJsonParse(evt.data);
      if (!msg) return;

      if (msg.event === 'connected_success') {
        try {
          sendTaskStart();
        } catch (e) {
          rejectStartOnce(e);
        }
        return;
      }

      if (msg.event === 'task_started') {
        ready = true;
        started = true;
        flushQueuedAudio();
        opts.onTaskStarted?.();
        resolveStartOnce();
        return;
      }

      if (msg.event === 'result_final') {
        opts.onResultFinal?.(msg.data || {});
        return;
      }

      if (msg.event === 'result_summary') {
        opts.onResultSummary?.(msg.data || {});
        return;
      }

      if (msg.event === 'task_finished') {
        finished = true;
        resolveFinishOnce();
        return;
      }

      if (msg.event === 'task_failed') {
        ready = false;
        started = false;
        const baseResp = (msg as { base_resp?: WsBaseResp }).base_resp;
        const errMsg =
          baseResp?.status_msg || `语音输入任务失败(${String(baseResp?.status_code ?? '')})`;
        opts.onTaskFailed?.(errMsg);
        rejectStartOnce(new Error(errMsg));
        rejectFinishOnce(new Error(errMsg));
      }
    };

    startPromise = new Promise<void>((resolve, reject) => {
      startResolve = resolve;
      startReject = reject;
    });
    return startPromise;
  };

  const sendAudio = (pcm16: Int16Array) => {
    if (!pcm16?.length) return;
    const packed = new Int16Array(pcm16.length);
    packed.set(pcm16);

    if (ready && ws && ws.readyState === WebSocket.OPEN) {
      sendPackedAudio(packed);
      return;
    }
    pushAudioToQueue(packed);
  };

  const finishTask = async (timeoutMs = 12000) => {
    if (!ws) return;
    finished = false;

    if (!(ready && started)) {
      if (!startPromise) {
        throw new Error('语音输入任务尚未启动');
      }
      await Promise.race([
        startPromise,
        new Promise<void>((_, reject) => {
          setTimeout(() => reject(new Error('等待 task_started 超时')), timeoutMs);
        }),
      ]);
    }

    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('语音输入 WS 未连接');
    }

    try {
      ws.send(JSON.stringify({ event: 'task_finish' }));
    } catch {
      return;
    }

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('等待 task_finished 超时'));
      }, timeoutMs);
      finishResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      finishReject = (reason) => {
        clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error(String(reason || '任务结束失败')));
      };
    });
  };

  const isReady = () => ready;

  return {
    connectAndStart,
    sendAudio,
    finishTask,
    close,
    isReady,
  };
}
