// Token 管理工具（使用 electron-store）

export interface UserInfo {
  phone?: string;
  /**
   * 兼容旧字段：token 实际单独存储在 store 中，不要求出现在 userInfo 内。
   * 如果某些调用方仍然传入 token，也允许保留。
   */
  token?: string;
  [key: string]: any;
}

type IpcRendererLike = {
  send?: (channel: string, ...args: any[]) => void;
};

function getIpcRenderer(): IpcRendererLike | null {
  // 优先使用 preload 暴露的 electronAPI
  const fromPreload = (window as any)?.electronAPI?.ipcRenderer as IpcRendererLike | undefined;
  if (fromPreload?.send) return fromPreload;

  // 兜底：部分环境可能允许 window.require('electron')
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as { ipcRenderer?: IpcRendererLike };
    if (ipcRenderer?.send) return ipcRenderer;
  } catch {
    // ignore
  }
  return null;
}

function safeGetLocalStorageItem(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSetLocalStorageItem(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

function safeRemoveLocalStorageItem(key: string): void {
  try {
    localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

const LAST_LOGIN_PHONE_KEY = 'last_login_phone';

/**
 * 保存“上次成功登录手机号”（永久保存，不随 clearToken 清除）
 */
export function setLastLoginPhone(phone: string): void {
  const digits = String(phone || '').replace(/\D/g, '');
  if (!digits) return;
  safeSetLocalStorageItem(LAST_LOGIN_PHONE_KEY, digits);
}

/**
 * 获取“上次成功登录手机号”
 */
export function getLastLoginPhone(): string | null {
  const v = safeGetLocalStorageItem(LAST_LOGIN_PHONE_KEY);
  if (!v) return null;
  const digits = String(v).replace(/\D/g, '');
  return digits || null;
}

/**
 * 保存 token（使用 electron-store）
 */
export function saveToken(
  token: string,
  userInfo?: Partial<UserInfo>,
  options?: { syncToMain?: boolean },
): void {
  try {
    // 重要：不要在渲染进程使用 ipcRenderer.sendSync（会阻塞 UI，导致“用着用着卡死”）
    // 渲染侧 token 统一落 localStorage，保持同步读取能力（axios 拦截器/路由判断会频繁调用 getToken）
    safeSetLocalStorageItem('Authorization', token);
    if (userInfo) {
      safeSetLocalStorageItem('user_info', JSON.stringify(userInfo));
    }

    // 同步本地存储后，尽力异步通知主进程更新 electron-store（不阻塞 UI）
    const shouldSync = options?.syncToMain !== false;
    if (!shouldSync) return;
    const ipcRenderer = getIpcRenderer();
    if (ipcRenderer?.send) {
      try {
        ipcRenderer.send('token-store-set-token', { token });
        if (userInfo) ipcRenderer.send('token-store-set-user-info', { userInfo });
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.error('保存 token 失败:', error);
    throw error; // 抛出错误以便上层处理
  }
}

/**
 * 获取 token（使用 electron-store）
 */
export function getToken(): string | null {
  try {
    // 同步读取，避免引入 async 造成全局改动；同时避免同步 IPC 阻塞 UI
    return safeGetLocalStorageItem('Authorization');
  } catch (error) {
    console.error('获取 token 失败:', error);
    return null;
  }
}

/**
 * 获取用户信息（使用 electron-store）
 */
export function getUserInfo(): UserInfo | null {
  try {
    const userInfoStr = safeGetLocalStorageItem('user_info');
    if (userInfoStr) {
      return JSON.parse(userInfoStr);
    }
    return null;
  } catch (error) {
    console.error('获取用户信息失败:', error);
    return null;
  }
}

/**
 * 清除 token（使用 electron-store）
 */
export function clearToken(): void {
  try {
    safeRemoveLocalStorageItem('Authorization');
    safeRemoveLocalStorageItem('user_info');

    // 尽力异步通知主进程清理（不阻塞 UI）
    const ipcRenderer = getIpcRenderer();
    if (ipcRenderer?.send) {
      try {
        ipcRenderer.send('token-store-clear-token');
      } catch {
        // ignore
      }
    }
  } catch (error) {
    console.error('清除 token 失败:', error);
  }
}
