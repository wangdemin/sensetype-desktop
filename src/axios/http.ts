// HTTP 请求封装 - 基于 axios
// 独立封装，可在其他项目中直接使用
// 根据现有接口调用方式生成，不改变现有调用逻辑

import axios, {
  AxiosInstance,
  AxiosRequestHeaders,
  AxiosResponse,
  InternalAxiosRequestConfig,
} from 'axios';
import config from '@/config';
import { getToken } from '@/utils/auth';
import { logTraceparentSend, withTraceparentHeader } from '@/utils/traceparent';

// 默认域名配置
const DEFAULT_DOMAIN = config.apiBaseUrl;
const STREAM_API_PATH = '/v2/asr/input_stream/sse';
const LEGACY_API_PATH = '/api/v1/asr/asr_input';
const REWRITE_API_PATH = '/v1/asr/input_rewrite';

// 类型定义
export type AsrMode = 'stream' | 'legacy';

// 获取默认 ASR API URL
export function getDefaultAsrApiUrl(mode: AsrMode = 'stream'): string {
  const path = mode === 'legacy' ? LEGACY_API_PATH : STREAM_API_PATH;
  return `${DEFAULT_DOMAIN}${path}`;
}

// 获取默认重写 API URL
export function getDefaultRewriteApiUrl(): string {
  return `${DEFAULT_DOMAIN}${REWRITE_API_PATH}`;
}

export interface ApiHeaders {
  [key: string]: string;
}

export interface RewriteResponse {
  result?: {
    rewritten_text?: string;
  };
}

export interface LegacyAsrResponse {
  result?: {
    final_text?: string;
  };
  final_text?: string;
}

export type TextFormatSegment = {
  text: string;
  speaker?: string;
};

export type TextFormatType = 'meeting_minutes' | string;

export type TextFormatRequestBody = {
  segments: TextFormatSegment[];
  format_type: TextFormatType;
  context?: string;
  custom_instructions?: string;
};

export type TextFormatResponse = {
  result?: {
    formatted_text?: string;
    format_type?: string;
    title?: string;
    key_points?: string[];
    word_count?: number;
    notes?: unknown[];
    structured_content?: unknown;
  };
  elapsed_s?: number;
};

const PREFERRED_LANGUAGE_STORAGE_KEY = 'preferred_language_variant';

function safeGetPreferredLanguageVariant(): string | null {
  try {
    const v = localStorage.getItem(PREFERRED_LANGUAGE_STORAGE_KEY);
    if (!v) return null;
    const s = String(v).trim();
    if (!s || s === 'None') return null;
    // 按产品约定：直接使用业务枚举 value（例如 Chinese/English/...）发给后端
    return s;
  } catch {
    return null;
  }
}

// 创建 axios 实例
export function createAxiosInstance(customHeaders?: ApiHeaders): AxiosInstance {
  const instance = axios.create({
    timeout: 600000, // 600秒超时
    withCredentials: false, // 对应 credentials: 'omit'
  });

  const notifyMainShowLogin = () => {
    try {
      // 关键：即使主窗口在托盘/后台，通过主进程弹出登录窗口
      const ipc = (
        window as unknown as {
          electronAPI?: { ipcRenderer?: { send?: (channel: string, ...args: unknown[]) => void } };
        }
      )?.electronAPI?.ipcRenderer;
      if (ipc?.send) {
        ipc.send('token-expired');
      }
    } catch {
      // ignore
    }
  };

  const navigateToLogin = () => {
    try {
      if (window?.location) {
        window.location.hash = '#/login';
      }
    } catch {
      // ignore
    }
  };

  // 请求拦截器 - 设置默认配置
  instance.interceptors.request.use(
    (config: InternalAxiosRequestConfig) => {
      // 如果有自定义 headers，合并到请求头
      if (customHeaders) {
        // 如果数据是 FormData，确保不覆盖 Content-Type（让浏览器自动设置）
        const isFormData = config.data instanceof FormData;
        if (isFormData) {
          // 从 customHeaders 中移除 Content-Type，避免覆盖 FormData 的自动设置
          const headersWithoutContentType = Object.fromEntries(
            Object.entries(customHeaders).filter(([key]) => key.toLowerCase() !== 'content-type'),
          );
          config.headers = {
            ...config.headers,
            ...headersWithoutContentType,
          } as AxiosRequestHeaders;
          // 确保删除任何可能的 Content-Type header（双重保险）
          if (config.headers) {
            const h = config.headers as unknown as Record<string, unknown>;
            delete h['Content-Type'];
            delete h['content-type'];
          }
        } else {
          config.headers = {
            ...config.headers,
            ...customHeaders,
          } as AxiosRequestHeaders;
        }
      } else {
        // 即使没有 customHeaders，如果是 FormData，也要确保删除 Content-Type
        const isFormData = config.data instanceof FormData;
        if (isFormData && config.headers) {
          const h = config.headers as unknown as Record<string, unknown>;
          delete h['Content-Type'];
          delete h['content-type'];
        }
      }

      {
        const h = (config.headers || {}) as unknown as Record<string, string>;
        const traceparent = String(h.traceparent || h.Traceparent || '').trim();
        if (!traceparent) {
          const merged = withTraceparentHeader(h);
          config.headers = merged.headers as unknown as AxiosRequestHeaders;
        } else {
          config.headers = {
            ...h,
            traceparent,
          } as unknown as AxiosRequestHeaders;
        }
      }

      {
        const h = (config.headers || {}) as unknown as Record<string, string>;
        const traceparent = String(h.traceparent || '').trim();
        const method = String(config.method || 'GET').toUpperCase();
        const endpoint = String(config.url || '');
        if (traceparent) logTraceparentSend('HTTP', `${method} ${endpoint}`, traceparent);
      }

      return config;
    },
    (error: unknown) => Promise.reject(error),
  );

  // 响应拦截器 - 统一错误处理
  instance.interceptors.response.use(
    (response: AxiosResponse) => {
      return response;
    },
    (error: unknown) => {
      // 统一错误处理逻辑
      const err = error as {
        response?: { status?: number; statusText?: string; data?: any };
        request?: unknown;
      };
      if (err.response) {
        const status = err.response.status;
        const statusText = err.response.statusText;
        const data = err.response.data;
        const serverMessage = (() => {
          try {
            if (typeof data === 'string') return data;
            if (data && typeof data === 'object') {
              if (typeof data.message === 'string' && data.message.trim()) return data.message;
              if (typeof data.error === 'string' && data.error.trim()) return data.error;
              if (typeof data.detail === 'string' && data.detail.trim()) return data.detail;
              if (typeof data.msg === 'string' && data.msg.trim()) return data.msg;
              // 某些接口直接返回 { errors: [...] }
              if (Array.isArray(data.errors) && data.errors.length) {
                const first = data.errors[0];
                if (typeof first === 'string') return first;
                if (first && typeof first === 'object' && typeof first.message === 'string')
                  return first.message;
              }
            }
          } catch {
            //
          }
          return '';
        })();

        // 401/403：认为登录态失效或无权限，直接弹出登录窗口（后台也要弹）
        // 说明：这里不依赖渲染进程“跳转路由”来解决窗口问题，而是通知主进程显示登录窗。
        if (status === 401 || status === 403) {
          try {
            notifyMainShowLogin();
            navigateToLogin();
          } catch {
            // ignore
          }
        }

        const errorMessage = `请求失败: ${status} ${statusText}${
          serverMessage ? ` - ${serverMessage}` : ''
        }`;
        if (status === 400) {
          return Promise.reject(new Error(serverMessage || '请求失败'));
        }
        return Promise.reject(new Error(errorMessage));
      } else if (err.request) {
        return Promise.reject(new Error('网络请求失败，请检查网络连接'));
      } else {
        return Promise.reject(err);
      }
    },
  );

  return instance;
}

/**
 * 判断当前运行平台
 */
function getPlatform(): string {
  const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
  return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
}

// 接口1: 文本重写接口
// 对应 events.ts 中的 rewriteSelectedText 函数
export async function rewriteTextRequest(
  // 原始文本
  originalText: string,
  // 重写文本
  rewriteInstruction: string,

  options: {
    headers?: ApiHeaders;
  } = {},
): Promise<RewriteResponse> {
  const { headers = {} } = options;

  // 生成重写接口地址（基于 ASR 接口的域名）
  const url = getDefaultRewriteApiUrl();
  const instance = createAxiosInstance(headers);
  const formBody = new URLSearchParams({
    original_text: originalText,
    rewrite_instruction: rewriteInstruction,
  }).toString();

  const response = await instance.request<RewriteResponse>({
    method: 'POST',
    url,
    headers: {
      accept: 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'x-platform': getPlatform(),
      'x-version': '0.0.1',
      'x-product': 'SenseType',
      Authorization: `Bearer ${getToken() || ''}`,
      ...headers,
    },
    data: formBody,
  });

  return response.data;
}

// 接口2: 语音识别接口（Stream 模式）
// 对应 recognition.ts 中的 sendAudioToApi 函数（stream 模式）
export async function sendAudioStreamRequest(
  // 音频 blob
  audioBlob: Blob,
  options: {
    headers?: ApiHeaders;
    recordOnly?: boolean;
    enableSop?: boolean;
    /** SSE: token 事件回调（按服务端顺序触发） */
    onToken?: (payload: { content: string; index?: number; raw: unknown }) => void;
    /** SSE: start 事件回调 */
    onStart?: (payload: { filename?: string; timestamp?: number; raw: unknown }) => void;
    /** SSE: sop 事件回调（你要求先只打印） */
    onSop?: (payload: { action?: string; content?: string; raw: unknown }) => void;
    /** 取消请求（用于“打断”录音识别请求） */
    signal?: AbortSignal;
  } = {},
): Promise<string> {
  console.log(`[sendAudioStreamRequest]开始发送音频请求(SSE)，Blob 大小:`, audioBlob.size, 'bytes');

  const refreshUserInfoOnFailure = () => {
    try {
      // 动态加载，避免把 http 层和用户信息刷新做成强耦合。
      void import('@/renderer/utils/refreshUserInfo')
        .then(({ requestUserInfoRefresh }) => {
          requestUserInfoRefresh({ reason: 'asr-stream-failed' });
        })
        .catch(() => {
          // ignore
        });
    } catch {
      // ignore
    }
  };

  // 验证音频数据
  if (!audioBlob || audioBlob.size === 0) {
    console.error('[sendAudioStreamRequest] 音频数据为空');
    throw new Error('音频数据为空，无法发送请求');
  }

  const {
    headers = {},
    recordOnly = false,
    enableSop = false,
    onToken,
    onStart,
    onSop,
    signal,
  } = options;
  const url = getDefaultAsrApiUrl('stream');
  console.log(`[sendAudioStreamRequest] 接口地址:`, url);

  // 过滤掉 Content-Type，让浏览器自动为 FormData 设置正确的 multipart/form-data 和 boundary
  const otherHeaders = Object.fromEntries(
    Object.entries(headers).filter(([key]) => key.toLowerCase() !== 'content-type'),
  );

  const fileName = 'recording.mp3';
  const audioFile = new File([audioBlob], fileName, { type: 'audio/mpeg' });
  const formData = new FormData();
  formData.append('file', audioFile, fileName);
  formData.append('model', 'sense-asr-deepthink-1.1');
  // 约定：始终开启 record_only（后端以该模式返回）。
  // 注意：这里的 `recordOnly` 仍保留给“客户端逻辑”使用（例如选中文字重写流程控制），
  // 但网络参数 record_only 永远为 true。
  if (enableSop) formData.append('enable_sop', 'true'); //帮我记一下的开关
  const targetLang = safeGetPreferredLanguageVariant();
  if (targetLang) formData.append('target_lang', targetLang);
  if (recordOnly) formData.set('target_lang', 'None');
  // formData.append('record_only', 'false');
  // if (recordOnly) formData.set('record_only', 'true');
  formData.append('record_only', 'true');
  const token = getToken();
  const authorization =
    token && /^bearer\s+/i.test(token) ? token : token ? `Bearer ${token}` : null;

  // 确保 headers 中不包含 Content-Type，让浏览器自动为 FormData 设置
  const requestHeaders: Record<string, string> = {
    accept: 'text/event-stream',
    'Accept-Language': 'en,zh-CN;q=0.9,zh;q=0.8',
    'Cache-Control': 'no-cache',
    'x-platform': getPlatform(),
    'x-version': '0.0.1',
    'x-product': 'SenseType',
    ...(authorization ? { Authorization: authorization } : {}),
    Pragma: 'no-cache',
    ...otherHeaders,
  };

  const traced = withTraceparentHeader(requestHeaders);

  // 再次确保 Content-Type 不存在（双重保险）
  delete traced.headers['Content-Type'];
  delete traced.headers['content-type'];
  logTraceparentSend('SSE', `POST ${url}`, traced.traceparent);

  // 离线快速失败：避免断网时长时间卡在 loading
  if (navigator?.onLine === false) {
    refreshUserInfoOnFailure();
    throw new Error('无网络连接');
  }

  // SSE 需要用 fetch 读取流（axios 在浏览器里不适合处理 text/event-stream）
  // 这里加“连接超时/空闲超时”，避免断网或代理异常时永久挂起
  const CONNECT_TIMEOUT_MS = 8000;
  const IDLE_TIMEOUT_MS = 15000;

  const innerCtrl = new AbortController();
  let timedOut = false;
  let idleTimedOut = false;
  let connectTimer: ReturnType<typeof setTimeout> | null = null;
  let idleTimer: ReturnType<typeof setTimeout> | null = null;

  const abortInner = () => {
    try {
      innerCtrl.abort();
    } catch {
      //
    }
  };

  const bumpIdle = () => {
    if (idleTimer) {
      try {
        clearTimeout(idleTimer);
      } catch {
        //
      }
      idleTimer = null;
    }
    idleTimer = setTimeout(() => {
      idleTimedOut = true;
      abortInner();
    }, IDLE_TIMEOUT_MS);
  };

  if (signal) {
    try {
      if (signal.aborted) abortInner();
      else signal.addEventListener('abort', abortInner, { once: true });
    } catch {
      //
    }
  }

  connectTimer = setTimeout(() => {
    timedOut = true;
    abortInner();
  }, CONNECT_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: traced.headers,
      body: formData,
      signal: innerCtrl.signal,
    });
  } catch (err: unknown) {
    if (connectTimer) {
      try {
        clearTimeout(connectTimer);
      } catch {
        //
      }
      connectTimer = null;
    }
    if (idleTimer) {
      try {
        clearTimeout(idleTimer);
      } catch {
        //
      }
      idleTimer = null;
    }
    // 外部主动取消：保持 AbortError 语义，让上层静默处理
    const errName = (err as { name?: unknown } | null)?.name;
    if (signal?.aborted || errName === 'AbortError') throw err;
    refreshUserInfoOnFailure();
    if (timedOut || idleTimedOut) throw new Error('网络连接超时，请检查网络连接');
    const m = String((err as { message?: unknown } | null)?.message || '');
    if (
      err instanceof TypeError ||
      /Failed to fetch|NetworkError|Load failed|net::|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
        m,
      )
    ) {
      throw new Error('网络请求失败，请检查网络连接');
    }
    throw err;
  } finally {
    if (connectTimer) {
      try {
        clearTimeout(connectTimer);
      } catch {
        //
      }
      connectTimer = null;
    }
  }

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    refreshUserInfoOnFailure();
    throw new Error(text || `HTTP ${res.status}`);
  }

  const contentType = res.headers.get('content-type') || '';
  if (!/text\/event-stream/i.test(contentType)) {
    // 服务端可能没按 SSE 返回
    const text = await res.text().catch(() => '');
    if (text) return text.trim();
    refreshUserInfoOnFailure();
    throw new Error('响应不是 text/event-stream');
  }

  if (!res.body) {
    refreshUserInfoOnFailure();
    throw new Error('响应无 body（SSE 不可用）');
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder('utf-8');
  let buf = '';

  let curEvent = '';
  let dataLines: string[] = [];
  const resolveDoneText = (obj: Record<string, unknown> | null): string => {
    const resultObj =
      obj?.result && typeof obj.result === 'object'
        ? (obj.result as Record<string, unknown>)
        : null;
    const candidates = [
      obj?.text,
      obj?.final_text,
      obj?.content,
      resultObj?.final_text,
      resultObj?.text,
    ];
    for (const candidate of candidates) {
      const text = String(candidate ?? '').trim();
      if (text) return text;
    }
    return '';
  };

  const dispatch = (): { done: boolean; text: string } | undefined => {
    if (!curEvent && dataLines.length === 0) return;
    const event = curEvent || 'message';
    const dataStr = dataLines.join('\n');
    curEvent = '';
    dataLines = [];

    let data: unknown = null;
    try {
      data = dataStr ? JSON.parse(dataStr) : null;
    } catch {
      data = dataStr;
    }
    const obj =
      data && typeof data === 'object' ? (data as Record<string, unknown>) : (null as null);

    if (event === 'start') {
      try {
        const filename = typeof obj?.filename === 'string' ? obj.filename : undefined;
        const timestamp = typeof obj?.timestamp === 'number' ? obj.timestamp : undefined;
        onStart?.({ filename, timestamp, raw: data });
      } catch {
        //
      }
    } else if (event === 'token') {
      const content = String(obj?.content ?? '');
      const index = typeof obj?.index === 'number' ? obj.index : undefined;
      // dlog('SSE 分片(token):', { index, content });
      try {
        onToken?.({ content, index, raw: data });
      } catch {
        //
      }
    } else if (event === 'sop') {
      try {
        if (onSop)
          onSop({
            action: typeof obj?.action === 'string' ? obj.action : undefined,
            content: typeof obj?.content === 'string' ? obj.content : undefined,
            raw: data,
          });
        // else console.log('[sendAudioStreamRequest] sop:', data);
      } catch {
        //
      }
    } else if (event === 'error') {
      const msg = String(obj?.message ?? 'SSE error');
      throw new Error(msg);
    } else if (event === 'done') {
      const text = resolveDoneText(obj);
      // dlog('SSE 完成(done):', { textLen: text.length });
      // 仅使用 done 中的最终文本；不再回退到 token 拼接。
      return { done: true as const, text };
    }

    return { done: false, text: '' };
  };

  bumpIdle();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      bumpIdle();
      // dlog('SSE 收到字节数:', value?.byteLength ?? 0);
      buf += dec.decode(value, { stream: true });

      while (true) {
        const nl = buf.indexOf('\n');
        if (nl < 0) break;
        let line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (line.endsWith('\r')) line = line.slice(0, -1);
        // if (debug && line) dlog('SSE 原始行:', line);

        if (line === '') {
          const r = dispatch();
          if (r?.done) {
            try {
              await reader.cancel();
            } catch {
              //
            }
            return r.text;
          }
          continue;
        }

        if (line.startsWith('event:')) {
          curEvent = line.slice('event:'.length).trim();
          continue;
        }
        if (line.startsWith('data:')) {
          dataLines.push(line.slice('data:'.length).trimStart());
          continue;
        }
        // ignore other fields (id:, retry:, etc.)
      }
    }
  } catch (err: unknown) {
    // 外部取消：保持 AbortError 语义
    const errName = (err as { name?: unknown } | null)?.name;
    if (signal?.aborted || errName === 'AbortError') throw err;
    refreshUserInfoOnFailure();
    if (timedOut || idleTimedOut) throw new Error('网络连接超时，请检查网络连接');
    const m = String((err as { message?: unknown } | null)?.message || '');
    if (
      /Failed to fetch|NetworkError|Load failed|net::|ECONN|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(
        m,
      )
    ) {
      throw new Error('网络请求失败，请检查网络连接');
    }
    throw err;
  } finally {
    if (idleTimer) {
      try {
        clearTimeout(idleTimer);
      } catch {
        //
      }
      idleTimer = null;
    }
  }

  // 流结束但没收到 done：视为无最终文本（由上层统一按空结果处理）。
  return '';
}
