/**
 * 主进程 IPC 请求处理器
 *
 * 作用：
 * 1. 接收渲染进程通过 IPC 发来的 HTTP 请求（GET/POST）
 * 2. 在主进程使用 axios 发起实际的 HTTP 请求（Node.js 环境，不受 CORS 限制）
 * 3. 统一管理 token：
 *    - 自动从 electron-store 读取 token 并注入到请求头
 *    - 登录成功后自动保存 token 到 store
 *    - 登出时自动清理 token
 * 4. 返回标准格式的响应给渲染进程：{ success: true, data } 或 { success: false, error }
 *
 * 调用流程：
 * 渲染进程 (src/services/request.ts)
 *   ↓ ipcRenderer.invoke('request-get', { url, params, headers })
 * 主进程 (本文件)
 *   ↓ axios.get(url, config) [自动注入 token]
 * 后端 API
 *   ↓ response
 * 主进程 (本文件)
 *   ↓ 包装为 { success, data/error }
 * 渲染进程 (src/services/request.ts)
 *
 * 为什么在主进程发起请求？
 * - 安全性：Token 不暴露在渲染进程（DevTools 看不到）
 * - 统一管理：所有 token 操作都在主进程，避免多窗口状态不一致
 * - 避免 CORS：主进程是 Node.js 环境，不受浏览器同源策略限制
 */

import { ipcMain } from 'electron';
import axios from 'axios';
import store from '../common/store';
import { getMainApiBaseUrl } from '../common/apiBaseUrl';

// ==================== Axios 配置 ====================

/**
 * 设置 axios 默认配置
 * - timeout: 5 分钟（适合长请求）
 */
const axiosConfig = {
  timeout: 5 * 60 * 1000,
  headers: {
    common: {
      accept: '',
    },
    get: {
      'Content-Type': 'application/json',
    },
    post: {
      'Content-Type': 'application/json',
    },
  },
  baseURL: getMainApiBaseUrl(),
};

Object.assign(axios.defaults, axiosConfig);

// ==================== IPC 处理器注册 ====================

function maskAuthHeader(v: unknown) {
  const s = typeof v === 'string' ? v : '';
  if (!s) return { exists: false };
  const bearer = /^bearer\s+/i.test(s);
  const head = s.slice(0, 12);
  const tail = s.slice(-8);
  return { exists: true, bearer, length: s.length, head, tail };
}

function normalizeBearer(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return null;
  return /^bearer\s+/i.test(s) ? s : `Bearer ${s}`;
}

function safeJoinUrl(baseURL: string, url: string): string {
  try {
    return new URL(url, baseURL.endsWith('/') ? baseURL : `${baseURL}/`).toString();
  } catch {
    // best-effort
    const b = baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL;
    const u = url.startsWith('/') ? url : `/${url}`;
    return `${b}${u}`;
  }
}

/**
 * 注册 IPC 请求处理器
 * 在应用启动时调用（src/main/mac/index.ts 或 src/main/win/index.ts）
 *
 * 注册的 IPC channels:
 * - 'request-get': 处理 GET 请求
 * - 'request-post': 处理 POST 请求
 * - 'request-put': 处理 PUT 请求
 * - 'request-del': 处理 DELETE 请求
 */
export const registerRequestHandlers = () => {
  const DEBUG = process.env.SENSETYPE_MAIN_DEBUG === '1';
  const dlog = (...args: unknown[]) => {
    if (DEBUG) console.log('[main-request]', ...args);
  };

  // ==================== GET 请求处理器 ====================

  /**
   * 处理 GET 请求
   * @param _event IPC 事件对象
   * @param payload { url: string, params?: object, headers?: object }
   * @returns { success: true, data } 或 { success: false, error }
   */
  ipcMain.handle('request-get', async (_event, { url, params, headers }) => {
    try {
      // 从 electron-store 读取 token 并自动注入到请求头
      const token = (store as unknown as { get: (key: string) => string | null }).get('token');
      const authorization = normalizeBearer(token);
      const config: {
        params?: unknown;
        headers: Record<string, string>;
      } = { params, headers: { ...headers } };

      if (authorization) {
        config.headers['Authorization'] = authorization;
      }

      if (DEBUG) {
        const baseURL = String(axios.defaults.baseURL || '');
        const fullUrl = typeof url === 'string' ? safeJoinUrl(baseURL, url) : String(url);
        // Avoid printing raw Authorization token; print only masked metadata
        dlog('GET 请求:', {
          baseURL,
          url,
          fullUrl,
          hasToken: !!token,
          Authorization: maskAuthHeader(config.headers?.Authorization),
          params,
        });
      } else {
        dlog('GET 请求:', { url, hasToken: !!token, params });
      }
      const response = await axios.get(url, config);

      // 返回成功响应（标准格式）
      return {
        success: true,
        data: response.data,
      };
    } catch (error: unknown) {
      // 返回错误响应（标准格式）
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
  });

  // ==================== POST 请求处理器 ====================

  /**
   * 处理 POST 请求
   * @param _event IPC 事件对象
   * @param payload { url: string, data?: any, config?: object }
   * @returns { success: true, data } 或 { success: false, error }
   */
  ipcMain.handle('request-post', async (_event, { url, data, config: reqConfig }) => {
    try {
      // 从 electron-store 读取 token 并自动注入到请求头
      const token = (store as unknown as { get: (key: string) => string | null }).get('token');
      const authorization = normalizeBearer(token);
      const finalConfig: {
        headers: Record<string, string>;
        [key: string]: unknown;
      } = { ...reqConfig, headers: { ...(reqConfig?.headers || {}) } };

      if (authorization) {
        finalConfig.headers['Authorization'] = authorization;
      }

      if (DEBUG) {
        const baseURL = String(axios.defaults.baseURL || '');
        const fullUrl = typeof url === 'string' ? safeJoinUrl(baseURL, url) : String(url);
        dlog('POST 请求:', {
          baseURL,
          url,
          fullUrl,
          hasToken: !!token,
          Authorization: maskAuthHeader(finalConfig.headers?.Authorization),
          data,
        });
      } else {
        dlog('POST 请求:', { url, hasToken: !!token, data });
      }
      const response = await axios.post(url, data, finalConfig);

      // 登录成功：自动提取并保存 token 到 electron-store
      if (typeof url === 'string' && url.includes('/api/user/login')) {
        const responseData = response.data as
          | { token?: string; data?: { token?: string }; result?: { token?: string } }
          | undefined;

        const tokenFromResponse =
          responseData?.token || responseData?.data?.token || responseData?.result?.token;

        if (typeof tokenFromResponse === 'string' && tokenFromResponse) {
          dlog('POST 登录成功 - 保存 token 到 store:', `[len=${tokenFromResponse.length}]`);
          (store as unknown as { set: (key: string, value: string) => void }).set(
            'token',
            tokenFromResponse,
          );
        } else {
          console.warn(
            '[main-request] POST 登录返回未包含 token，跳过保存。response.data:',
            responseData,
          );
        }
      }

      // 返回成功响应（标准格式）
      return {
        success: true,
        data: response.data,
      };
    } catch (error: unknown) {
      // 返回错误响应（标准格式）
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
  });

  // ==================== PUT 请求处理器 ====================

  /**
   * 处理 PUT 请求
   * @param _event IPC 事件对象
   * @param payload { url: string, data?: any, config?: object }
   * @returns { success: true, data } 或 { success: false, error }
   */
  ipcMain.handle('request-put', async (_event, { url, data, config: reqConfig }) => {
    try {
      const token = (store as unknown as { get: (key: string) => string | null }).get('token');
      const authorization = normalizeBearer(token);
      const finalConfig: {
        headers: Record<string, string>;
        [key: string]: unknown;
      } = { ...reqConfig, headers: { ...(reqConfig?.headers || {}) } };

      if (authorization) {
        finalConfig.headers['Authorization'] = authorization;
      }

      if (DEBUG) {
        const baseURL = String(axios.defaults.baseURL || '');
        const fullUrl = typeof url === 'string' ? safeJoinUrl(baseURL, url) : String(url);
        dlog('PUT 请求:', {
          baseURL,
          url,
          fullUrl,
          hasToken: !!token,
          Authorization: maskAuthHeader(finalConfig.headers?.Authorization),
          data,
        });
      } else {
        dlog('PUT 请求:', { url, hasToken: !!token });
      }

      const response = await axios.put(url, data, finalConfig);
      return { success: true, data: response.data };
    } catch (error: unknown) {
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
  });

  // ==================== DELETE 请求处理器 ====================

  /**
   * 处理 DELETE 请求
   * @param _event IPC 事件对象
   * @param payload { url: string, data?: any, config?: object }
   * @returns { success: true, data } 或 { success: false, error }
   */
  ipcMain.handle('request-del', async (_event, { url, data, config: reqConfig }) => {
    try {
      const token = (store as unknown as { get: (key: string) => string | null }).get('token');
      const authorization = normalizeBearer(token);
      const finalConfig: {
        headers: Record<string, string>;
        [key: string]: unknown;
      } = { ...(reqConfig || {}), headers: { ...(reqConfig?.headers || {}) } };

      if (authorization) {
        finalConfig.headers['Authorization'] = authorization;
      }

      // axios.delete 的 body 需要放在 config.data
      if (data !== undefined) {
        (finalConfig as { data?: unknown }).data = data;
      }

      if (DEBUG) {
        const baseURL = String(axios.defaults.baseURL || '');
        const fullUrl = typeof url === 'string' ? safeJoinUrl(baseURL, url) : String(url);
        dlog('DELETE 请求:', {
          baseURL,
          url,
          fullUrl,
          hasToken: !!token,
          Authorization: maskAuthHeader(finalConfig.headers?.Authorization),
          hasBody: data !== undefined,
        });
      } else {
        dlog('DELETE 请求:', { url, hasToken: !!token });
      }

      const response = await axios.delete(url, finalConfig);
      return { success: true, data: response.data };
    } catch (error: unknown) {
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
  });
};
