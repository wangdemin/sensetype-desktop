import { BrowserWindow, ipcMain } from 'electron';
import { clearAuth, getToken, getUserInfo, setToken, setUserInfo } from '../common/authCache';

export const registerTokenStoreHandlers = () => {
  const DEBUG = process.env.SENSETYPE_MAIN_DEBUG === '1';
  const maskAuth = (v: unknown) => {
    const s = typeof v === 'string' ? v : '';
    if (!s) return { exists: false };
    const bearer = /^bearer\s+/i.test(s);
    const head = s.slice(0, 12);
    const tail = s.slice(-8);
    return { exists: true, bearer, length: s.length, head, tail };
  };

  const broadcastAuthChanged = () => {
    try {
      const payload = { token: getToken(), userInfo: getUserInfo() };
      for (const win of BrowserWindow.getAllWindows()) {
        try {
          win.webContents.send('auth-changed', payload);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  };

  // 设置 token
  ipcMain.on('token-store-set-token', (event, { token }) => {
    try {
      if (DEBUG) {
        console.log('[token-store][debug] set token:', maskAuth(token));
      }
      setToken(token);
      broadcastAuthChanged();
      event.returnValue = { success: true };
    } catch (error) {
      console.error('tokenStore - 保存 token 失败:', error);
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // 获取 token
  ipcMain.on('token-store-get-token', (event) => {
    try {
      event.returnValue = getToken();
    } catch {
      event.returnValue = null;
    }
  });

  // 获取 token（async / invoke 版本；用于渲染进程启动时非阻塞拉取）
  ipcMain.handle('token-store-get-token', async () => {
    try {
      return getToken();
    } catch {
      return null;
    }
  });

  // 设置用户信息
  ipcMain.on('token-store-set-user-info', (event, { userInfo }) => {
    try {
      setUserInfo(userInfo);
      broadcastAuthChanged();
      event.returnValue = { success: true };
    } catch (error) {
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });

  // 获取用户信息
  ipcMain.on('token-store-get-user-info', (event) => {
    try {
      event.returnValue = getUserInfo();
    } catch {
      event.returnValue = null;
    }
  });

  // 获取用户信息（async / invoke 版本）
  ipcMain.handle('token-store-get-user-info', async () => {
    try {
      return getUserInfo();
    } catch {
      return null;
    }
  });

  // 清除 token
  ipcMain.on('token-store-clear-token', (event) => {
    try {
      clearAuth();
      broadcastAuthChanged();
      event.returnValue = { success: true };
    } catch (error) {
      event.returnValue = {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  });
};
