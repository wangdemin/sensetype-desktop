import config from '@/config';
import { getToken } from '@/utils/auth';

const MEETING_MINUTES_WS_PATH = '/v1/ws/audio/meeting-minutes';

export const DEFAULT_MEETING_MINUTES_WS_URL = `${config.wsBaseUrl}${MEETING_MINUTES_WS_PATH}`;
// export const DEFAULT_MEETING_MINUTES_WS_URL = `ws://180.184.148.134:25632/ws/v2/audio/meeting-minutes`;

type WsBaseResp = {
  status_code?: number;
  status_msg?: string;
};

type WsWord = {
  word: string;
  start_time: number;
  end_time: number;
};

type WsResultFinalData = {
  text?: string;
  translation?: string;
  is_final?: boolean;
  segment_id?: number;
  timestamp_start?: number;
  timestamp_end?: number;
  words?: WsWord[];
};

type WsResultSummarySection = {
  heading?: string;
  items?: string[];
};

type WsResultSummaryData = {
  title?: string;
  content?: string;
  sections?: WsResultSummarySection[];
  raw_sentences?: Array<{ text?: string; words?: WsWord[] }>;
  translated_title?: string;
  translated_content?: string;
  translated_sections?: WsResultSummarySection[];
  summary_index?: number;
  is_final?: boolean;
};

type WsTaskPausedData = {
  total_segment_count?: number;
  pre_pause_segment_count?: number;
  new_segments?: WsResultFinalData[];
  summary?: Omit<WsResultSummaryData, 'is_final'>;
};

type WsServerMessage =
  | { event: 'connected_success'; session_id?: string; base_resp?: WsBaseResp }
  | { event: 'task_started'; session_id?: string; base_resp?: WsBaseResp }
  | {
      event: 'task_paused';
      session_id?: string;
      data?: WsTaskPausedData;
      base_resp?: WsBaseResp;
    }
  | { event: 'task_resumed'; session_id?: string; base_resp?: WsBaseResp }
  | {
      event: 'result_final';
      session_id?: string;
      data?: WsResultFinalData;
      base_resp?: WsBaseResp;
    }
  | {
      event: 'result_summary';
      session_id?: string;
      data?: WsResultSummaryData;
      base_resp?: WsBaseResp;
    }
  | { event: 'task_finished'; session_id?: string; base_resp?: WsBaseResp }
  | { event: 'task_failed'; session_id?: string; base_resp?: WsBaseResp }
  | { event: string; [k: string]: unknown };

export type MeetingMinutesWsClientOptions = {
  url?: string;
  summaryIntervalS?: number;
  targetLanguage?: string;
  hotWords?: string[];
  abbreviations?: Record<string, string>;
  onResultFinal?: (data: WsResultFinalData) => void;
  onResultSummary?: (data: WsResultSummaryData) => void;
  onTaskPaused?: (data: WsTaskPausedData) => void;
  onTaskResumed?: () => void;
  onTaskFailed?: (message: string) => void;
  onWsError?: (message: string) => void;
};

export type MeetingMinutesWsClient = {
  connectAndStart: () => Promise<void>;
  sendAudio: (pcm16: Int16Array) => void;
  pauseTask: (timeoutMs?: number) => Promise<void>;
  resumeTask: (timeoutMs?: number) => Promise<void>;
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

export function createMeetingMinutesWsClient(
  opts: MeetingMinutesWsClientOptions = {},
): MeetingMinutesWsClient {
  const url = appendTokenToWsUrl(opts.url || DEFAULT_MEETING_MINUTES_WS_URL);
  let ws: WebSocket | null = null;
  let ready = false;
  let started = false;
  let finished = false;

  let startResolve: (() => void) | null = null;
  let startReject: ((reason?: unknown) => void) | null = null;
  let startPromise: Promise<void> | null = null;
  let pauseResolve: (() => void) | null = null;
  let pauseReject: ((reason?: unknown) => void) | null = null;
  let resumeResolve: (() => void) | null = null;
  let resumeReject: ((reason?: unknown) => void) | null = null;
  let finishResolve: (() => void) | null = null;
  let finishReject: ((reason?: unknown) => void) | null = null;

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

  const rejectPauseOnce = (reason: unknown) => {
    if (!pauseReject) return;
    pauseReject(reason);
    pauseReject = null;
    pauseResolve = null;
  };

  const resolvePauseOnce = () => {
    if (!pauseResolve) return;
    pauseResolve();
    pauseResolve = null;
    pauseReject = null;
  };

  const rejectResumeOnce = (reason: unknown) => {
    if (!resumeReject) return;
    resumeReject(reason);
    resumeReject = null;
    resumeResolve = null;
  };

  const resolveResumeOnce = () => {
    if (!resumeResolve) return;
    resumeResolve();
    resumeResolve = null;
    resumeReject = null;
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
    rejectStartOnce(new Error('会议纪要 WS 已关闭'));
    rejectPauseOnce(new Error('会议纪要 WS 已关闭'));
    rejectResumeOnce(new Error('会议纪要 WS 已关闭'));
    rejectFinishOnce(new Error('会议纪要 WS 已关闭'));
  };

  const sendTaskStart = () => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('WebSocket 未连接');
    }
    const payload = {
      event: 'task_start',
      model: 'sense-asr-deepthink-1.1',
      audio_setting: {
        sample_rate: 16000,
        format: 'pcm',
        channel: 1,
      },
      voice_input_setting: {
        target_language: opts.targetLanguage || '',
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
      // wait for connected_success before task_start
    };

    ws.onerror = () => {
      ready = false;
      opts.onWsError?.('会议纪要 WS 连接失败');
      rejectStartOnce(new Error('会议纪要 WS 连接失败'));
      rejectPauseOnce(new Error('会议纪要 WS 连接失败'));
      rejectResumeOnce(new Error('会议纪要 WS 连接失败'));
      rejectFinishOnce(new Error('会议纪要 WS 连接失败'));
    };

    ws.onclose = () => {
      const wasStarted = started;
      ready = false;
      started = false;
      if (wasStarted && !finished) {
        rejectPauseOnce(new Error('会议纪要 WS 连接已关闭'));
        rejectResumeOnce(new Error('会议纪要 WS 连接已关闭'));
        rejectFinishOnce(new Error('会议纪要 WS 连接已关闭'));
      } else if (!wasStarted) {
        rejectStartOnce(new Error('会议纪要 WS 连接已关闭'));
      }
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
        resolveStartOnce();
        return;
      }

      if (msg.event === 'task_paused') {
        opts.onTaskPaused?.(msg.data || {});
        resolvePauseOnce();
        return;
      }

      if (msg.event === 'task_resumed') {
        opts.onTaskResumed?.();
        resolveResumeOnce();
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
          baseResp?.status_msg || `会议纪要任务失败(${String(baseResp?.status_code ?? '')})`;
        opts.onTaskFailed?.(errMsg);
        rejectStartOnce(new Error(errMsg));
        rejectPauseOnce(new Error(errMsg));
        rejectResumeOnce(new Error(errMsg));
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
    if (!ready || !ws || ws.readyState !== WebSocket.OPEN) return;
    if (!pcm16?.length) return;
    // Ensure a tightly-packed ArrayBuffer is sent.
    const packed = new Int16Array(pcm16.length);
    packed.set(pcm16);
    ws.send(packed.buffer);
  };

  const pauseTask = async (timeoutMs = 8000) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('会议纪要 WS 未连接');
    }
    if (!ready || !started) {
      throw new Error('会议纪要任务尚未启动');
    }
    const wsConn = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('等待 task_paused 超时'));
      }, timeoutMs);
      pauseResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      pauseReject = (reason) => {
        clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error(String(reason || '暂停失败')));
      };
      try {
        wsConn.send(JSON.stringify({ event: 'task_pause' }));
      } catch {
        clearTimeout(timer);
        reject(new Error('发送 task_pause 失败'));
      }
    });
  };

  const resumeTask = async (timeoutMs = 8000) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) {
      throw new Error('会议纪要 WS 未连接');
    }
    if (!ready || !started) {
      throw new Error('会议纪要任务尚未启动');
    }
    const wsConn = ws;
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error('等待 task_resumed 超时'));
      }, timeoutMs);
      resumeResolve = () => {
        clearTimeout(timer);
        resolve();
      };
      resumeReject = (reason) => {
        clearTimeout(timer);
        reject(reason instanceof Error ? reason : new Error(String(reason || '恢复失败')));
      };
      try {
        wsConn.send(JSON.stringify({ event: 'task_resume' }));
      } catch {
        clearTimeout(timer);
        reject(new Error('发送 task_resume 失败'));
      }
    });
  };

  const finishTask = async (timeoutMs = 12000) => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    if (!ready || !started) {
      throw new Error('会议纪要任务尚未启动');
    }
    finished = false;
    const wsConn = ws;
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
      try {
        wsConn.send(JSON.stringify({ event: 'task_finish' }));
      } catch {
        clearTimeout(timer);
        reject(new Error('发送 task_finish 失败'));
      }
    });
  };

  const isReady = () => ready;

  return {
    connectAndStart,
    sendAudio,
    pauseTask,
    resumeTask,
    finishTask,
    close,
    isReady,
  };
}
