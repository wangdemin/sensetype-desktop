/**
 * services 层请求封装：通过 IPC 交给主进程发起请求
 *
 * 架构说明：
 * - 渲染进程（BrowserWindow）通过 IPC 调用主进程的请求处理器
 * - 主进程使用 axios 发起请求（Node.js 环境，不受浏览器 CORS 限制）
 * - 主进程会从 electron-store 读取 token 并自动注入 Authorization header
 *
 * 为什么用 IPC 而不是渲染进程直接用 axios？
 * 1. **统一 token 管理**：主进程统一管理 token，渲染进程无需关心 token 存储和注入
 * 2. **安全性**：Token 不暴露在渲染进程（DevTools 看不到），降低泄露风险
 * 3. **业务逻辑统一**：登录成功自动保存 token，登出自动清理，统一错误处理
 *
 * 注意：
 * - 虽然窗口配置了 `webSecurity: false`（可绕过 CORS），但用户相关接口仍走 IPC
 * - 语音识别等不需要 token 的接口（src/axios/http.ts）直接在渲染进程用 axios
 */

import { logTraceparentSend, withTraceparentHeader } from '@/utils/traceparent';

// ==================== 类型定义 ====================

/**
 * IPC Renderer 接口类型定义
 */
interface IpcRendererLike {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
  send?: (channel: string, ...args: unknown[]) => void;
}

/**
 * 包装后的错误类型
 */
export interface WrappedError {
  message: string;
  response: { status: number; data: unknown } | null;
}

/**
 * 统一响应类型
 * @template T 响应数据的类型
 */
export type ResponseType<T = unknown> =
  | { success: true; data: T }
  | { success: false; error: WrappedError };

/**
 * 错误响应类型
 */
type ErrorResponse = { success: false; error: WrappedError };

/**
 * 请求配置
 */
interface RequestConfig {
  headers?: Record<string, string>;
  [key: string]: unknown;
}

// ==================== 工具函数 ====================

/**
 * 判断当前运行平台
 */
function getPlatform(): string {
  const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
  return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
}

/**
 * 通用请求头配置
 */
const COMMON_HEADERS: Record<string, string> = {
  'Content-Type': 'application/json',
  'x-language': 'zh-cn',
  'x-platform': getPlatform(),
  // 'x-platform': 'WEB',
  'x-version': '0.0.1',
  'x-product': 'SenseType',
};

/**
 * 准备请求头：合并通用 headers 和自定义 headers
 */
function prepareHeaders(customHeaders?: Record<string, string>): {
  headers: Record<string, string>;
  traceparent: string;
} {
  return withTraceparentHeader({ ...COMMON_HEADERS, ...(customHeaders || {}) });
}

/**
 * 调用主进程 IPC 方法
 */
async function invokeMain<T = unknown>(channel: string, payload: unknown): Promise<T> {
  const ipc = window.electronAPI.ipcRenderer;
  if (!ipc?.invoke) {
    throw new Error(
      'ipcRenderer.invoke 不可用：请确认 preload 已暴露 window.electronAPI.ipcRenderer',
    );
  }
  const payloadObj =
    payload && typeof payload === 'object' ? (payload as Record<string, unknown>) : null;
  const endpoint = typeof payloadObj?.url === 'string' ? payloadObj.url : channel;
  const traceparent = String(payloadObj?.traceparent || '').trim();
  if (traceparent) logTraceparentSend('IPC', `${channel} ${endpoint}`, traceparent);
  return (await ipc.invoke(channel, payload)) as T;
}

// ==================== 错误处理 ====================

/**
 * 判断是否为标准错误响应格式
 */
function isErrorResponse(error: unknown): error is ErrorResponse {
  return (
    typeof error === 'object' &&
    error !== null &&
    'success' in error &&
    (error as { success: unknown }).success === false &&
    'error' in error
  );
}

/**
 * 包装错误对象为标准格式
 */
function wrapError(error: unknown): ErrorResponse {
  // 如果已经是标准格式，直接使用
  if (isErrorResponse(error)) {
    return error;
  }

  // 否则手动包装
  const err = error as { message?: string; response?: { status?: number; data?: unknown } };
  return {
    success: false,
    error: {
      message: err?.message || 'Request Error',
      response: err?.response
        ? {
            status: err.response.status || 0,
            data: err.response.data,
          }
        : null,
    },
  };
}

/**
 * 处理 HTTP 错误状态码
 */
function handleHttpError(error: ErrorResponse): void {
  const status = error.error.response?.status;

  // 401: Token 失效，跳转登录页并通知主进程
  if (status === 401) {
    try {
      console.log('Token 可能已失效，触发重新登录（不清 token）');
      window.electronAPI?.ipcRenderer?.send('token-expired');
      if (window.location) {
        window.location.hash = '#/login';
      }
    } catch {
      // ignore
    }
  }
  // 403: 权限不足，仅记录警告（实际登出由调用方处理）
  else if (status === 403) {
    console.warn('访问被禁止，您没有权限查看此内容');
  }
}

/**
 * 包装并处理错误：统一错误格式，并根据状态码执行相应的错误处理逻辑
 */
function wrapAndHandleError(error: unknown): ErrorResponse {
  const wrapped = wrapError(error);
  handleHttpError(wrapped);
  return wrapped;
}

// ==================== 请求方法 ====================

/**
 * 封装的 GET 请求
 * @template T 响应数据的类型
 * @param url 请求 URL（相对路径或绝对路径）
 * @param params 查询参数对象
 * @param configs 可选配置（headers 等）
 * @returns Promise<ResponseType<T>> 成功时 resolve，失败时 reject
 *
 * @example
 * ```ts
 * const result = await get<UserInfo>('/api/user/self');
 * if (result.success) {
 *   console.log(result.data);
 * }
 * ```
 */
export async function get<T = unknown>(
  url: string,
  params?: Record<string, unknown>,
  configs?: RequestConfig,
): Promise<ResponseType<T>> {
  try {
    const { headers, traceparent } = prepareHeaders(configs?.headers);
    const resp = await invokeMain<ResponseType<T>>('request-get', { url, params, headers, traceparent });
    // console.log(url, params, resp);
    // console.log(wrapAndHandleError(resp));

    // 检查响应格式
    if (resp && typeof resp === 'object' && 'success' in resp && resp.success) {
      return resp;
    }

    // 格式不正确，包装为错误
    return Promise.reject(wrapAndHandleError(resp));
  } catch (err) {
    return Promise.reject(wrapAndHandleError(err));
  }
}

export async function post<T = unknown>(
  url: string,
  data?: unknown,
  configs?: RequestConfig,
): Promise<ResponseType<T>> {
  try {
    const { headers, traceparent } = prepareHeaders(configs?.headers);
    const config = { ...configs, headers };
    const resp = await invokeMain<ResponseType<T>>('request-post', { url, data, config, traceparent });

    // 检查响应格式
    if (resp && typeof resp === 'object' && 'success' in resp && resp.success) {
      return resp;
    }

    console.log(resp);
    console.log(wrapAndHandleError(resp));

    // 格式不正确，包装为错误
    return Promise.reject(wrapAndHandleError(resp));
  } catch (err) {
    return Promise.reject(wrapAndHandleError(err));
  }
}

export async function put<T = unknown>(
  url: string,
  data?: unknown,
  configs?: RequestConfig,
): Promise<ResponseType<T>> {
  try {
    const { headers, traceparent } = prepareHeaders(configs?.headers);
    const config = { ...configs, headers };
    const resp = await invokeMain<ResponseType<T>>('request-put', { url, data, config, traceparent });

    if (resp && typeof resp === 'object' && 'success' in resp && resp.success) {
      return resp;
    }
    return Promise.reject(wrapAndHandleError(resp));
  } catch (err) {
    return Promise.reject(wrapAndHandleError(err));
  }
}

export async function del<T = unknown>(
  url: string,
  data?: unknown,
  configs?: RequestConfig,
): Promise<ResponseType<T>> {
  try {
    const { headers, traceparent } = prepareHeaders(configs?.headers);
    const config = { ...configs, headers };
    const resp = await invokeMain<ResponseType<T>>('request-del', { url, data, config, traceparent });

    if (resp && typeof resp === 'object' && 'success' in resp && resp.success) {
      return resp;
    }
    return Promise.reject(wrapAndHandleError(resp));
  } catch (err) {
    return Promise.reject(wrapAndHandleError(err));
  }
}
