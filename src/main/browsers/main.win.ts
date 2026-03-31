import { app, BrowserWindow, globalShortcut, ipcMain } from 'electron';
import path, { join } from 'path';
import { initialize, enable } from '@electron/remote/main';
import axios from 'axios';

import { WINDOW_HEIGHT, WINDOW_MIN_HEIGHT, WINDOW_MIN_WIDTH, WINDOW_WIDTH } from './config';
import { getIconPath } from '../common/getIconPath';
import { clearAuth, getToken, setUserInfo } from '../common/authCache';
import { getHoldRecorderStatus } from '../win/globalRecorderHotkey';
import { hideRewriteOverlay } from '../win/rewriteOverlayWindow';
import { tryLoadKeyhook } from '../win/keyhookLoader';
import { getHoldToRecordConfig } from '../common/settingsStore';
import { getMainApiBaseUrl } from '../common/apiBaseUrl';
import appConfig from '../../config';

let remoteInitialized = false;
function ensureRemoteInitialized() {
  if (remoteInitialized) return;
  try {
    initialize();
  } finally {
    remoteInitialized = true;
  }
}

export default () => {
  // IMPORTANT:
  // - 不要在模块顶层执行 initialize()（会在“第二实例”也被 import 到，从而产生副作用）
  // - 仅在真正进入主实例逻辑时再初始化 remote
  ensureRemoteInitialized();
  let win: BrowserWindow | undefined = undefined;
  let isQuitting = false;
  let trayVisibilityCallback: ((visible: boolean) => void) | null = null;
  const MAIN_API_BASE_URL = getMainApiBaseUrl();
  let mainWindowReadyToShow = false;
  let pendingShowMainWindow = false;
  let desiredTrayVisible = false;
  let appLifecycleBound = false;
  let ipcBound = false;

  const init = () => {
    bindAppLifecycleOnce();
    bindIpcOnce();
    // 先创建主窗口但不显示
    createWindow();

    if (win) enable(win.webContents);

    // 先检查token，如果有token且有效则直接显示主窗口，否则显示登录窗口
    checkAuthAndShowWindow().catch((err) => {
      console.error('启动时检查登录状态失败:', err);
      showLoginWindow();
    });
  };

  const bindAppLifecycleOnce = () => {
    if (appLifecycleBound) return;
    appLifecycleBound = true;

    app.on('before-quit', () => {
      isQuitting = true;
    });

    // 退出时清理全局资源，避免重复绑定/热重载导致的副作用
    app.on('will-quit', () => {
      try {
        globalShortcut.unregisterAll();
      } catch {
        // ignore
      }

      try {
        if (ipcBound) {
          ipcMain.removeListener('login-success', handleLoginSuccess);
          ipcMain.removeAllListeners('logout-success');
          ipcMain.removeAllListeners('token-expired');
          ipcBound = false;
        }
      } catch {
        // ignore
      }
    });
  };

  const bindIpcOnce = () => {
    if (ipcBound) return;
    ipcBound = true;

    // 注册登录成功事件监听器
    ipcMain.on('login-success', handleLoginSuccess);

    // 引导页：锁定/解锁窗口缩放
    ipcMain.on('window-set-resizable', (_event, resizable: boolean) => {
      try {
        if (!win || win.isDestroyed()) return;
        win.setResizable(!!resizable);
        win.setMaximizable(!!resizable);
        win.setFullScreenable(false);
        if (!resizable) {
          // 如果当前是最大化状态，先恢复
          if (win.isMaximized()) win.unmaximize();
        }
      } catch {
        // ignore
      }
    });

    // 监听登出成功事件
    ipcMain.on('logout-success', () => {
      console.log('收到登出成功事件，显示登录窗口');
      clearAuthInStore();
      // 退出：先在主窗口展示遮罩，等登录窗渲染好后再切换（避免突然消失/白屏）
      sendAppTransition(true, '正在退出登录...');
      showLoginWindow();
    });

    // 监听 token 失效事件
    ipcMain.on('token-expired', () => {
      console.log('收到 token 失效事件，显示登录窗口');
      clearAuthInStore();
      sendAppTransition(true, '登录已过期，正在退出...');
      showLoginWindow();
    });

    // 渲染进程请求主进程重新校验登录态：
    // - 默认仅“后台校验/同步 userInfo”，不影响窗口显示（避免语音/积分刷新把隐藏窗口拉到前台）
    // - 只有显式传入 { show: true } 时，才允许根据校验结果显示主窗口/登录页
    let authCheckInFlight = false;
    ipcMain.on('auth-check-request', (_event, payload?: unknown) => {
      if (authCheckInFlight) return;
      authCheckInFlight = true;
      const show = (payload as { show?: unknown } | null)?.show === true;
      const job = show ? checkAuthAndShowWindow() : checkAuthAndSyncOnly();
      job
        .catch((e) => console.warn('[auth-check-request] failed:', e))
        .finally(() => {
          authCheckInFlight = false;
        });
    });
  };

  const sendAppTransition = (visible: boolean, text?: string) => {
    try {
      if (!win || win.isDestroyed()) return;
      win.webContents?.send?.('app-transition', { visible, ...(text ? { text } : {}) });
    } catch {
      // ignore
    }
  };

  const waitForRendererRouteReady = (
    targetWin: BrowserWindow | null | undefined,
    expectedPathname: string,
    timeoutMs = 2000,
  ): Promise<'ready' | 'timeout' | 'unavailable'> => {
    try {
      if (!targetWin || targetWin.isDestroyed()) return Promise.resolve('unavailable');
      const wcId = targetWin.webContents?.id;
      if (!wcId) return Promise.resolve('unavailable');

      return new Promise((resolve) => {
        let done = false;
        const cleanup = () => {
          if (done) return;
          done = true;
          try {
            ipcMain.removeListener('renderer-route-ready', handler);
          } catch {
            // ignore
          }
        };

        const handler = (
          event: Electron.IpcMainEvent,
          payload: { pathname?: unknown; hash?: unknown; at?: unknown } | undefined,
        ) => {
          try {
            if (event.sender?.id !== wcId) return;
            const pathname = typeof payload?.pathname === 'string' ? payload?.pathname : '';
            if (pathname !== expectedPathname) return;
            cleanup();
            resolve('ready');
          } catch {
            // ignore
          }
        };

        ipcMain.on('renderer-route-ready', handler);

        setTimeout(() => {
          cleanup();
          resolve('timeout');
        }, timeoutMs);
      });
    } catch {
      return Promise.resolve('unavailable');
    }
  };

  const safeExecuteJavaScript = (targetWin: BrowserWindow | undefined, code: string) => {
    try {
      if (!targetWin || targetWin.isDestroyed()) return;
      targetWin.webContents?.executeJavaScript(code).catch(() => {
        // ignore
      });
    } catch {
      // ignore
    }
  };

  const ensureMainRoute = () => {
    const code = `
      (function() {
        const currentHash = String(window.location.hash || '');
        if (currentHash.startsWith('#/login')) {
          window.location.hash = '#/';
        } else if (!currentHash || currentHash === '#' || currentHash === '') {
          window.location.hash = '#/';
        }
      })();
    `;
    safeExecuteJavaScript(win, code);
  };

  const clearAuthInStore = () => {
    try {
      clearAuth();
    } catch (e) {
      console.error('清理本地登录态失败:', e);
    }
  };

  const showMainWindowSafely = () => {
    console.log('打开主窗口');
    if (!win || win.isDestroyed()) {
      console.warn('打开主窗口失败：win 不存在或已销毁');
      return;
    }

    pendingShowMainWindow = true;
    desiredTrayVisible = true;

    const forceShow = (reason: string) => {
      try {
        console.log(`强制显示主窗口（${reason}）`, {
          isVisible: win?.isVisible?.(),
          isMinimized: win?.isMinimized?.(),
          isDestroyed: win?.isDestroyed?.(),
          isLoading: win?.webContents?.isLoading?.(),
          mainWindowReadyToShow,
          pendingShowMainWindow,
        });

        if (!win || win.isDestroyed()) return;
        if (win.isMinimized?.()) win.restore();
        win.show();
        win.focus();
        trayVisibilityCallback?.(true);
      } catch (e) {
        console.error('强制显示主窗口失败:', e);
      }
    };

    // 避免“闪一下”：优先在 ready-to-show 后显示
    if (mainWindowReadyToShow) {
      forceShow('ready-to-show 已就绪');
      return;
    }

    // 兜底1：如果 ready-to-show 没触发，但页面加载完成了，也显示（少量场景会这样）
    try {
      win.webContents?.once?.('did-finish-load', () => {
        if (win && pendingShowMainWindow && !win.isDestroyed() && !win.isVisible()) {
          forceShow('did-finish-load 兜底');
        }
      });
    } catch {
      // ignore
    }

    // 兜底2：超时仍未显示，则强制显示（防止卡死在隐藏状态）
    setTimeout(() => {
      if (pendingShowMainWindow && win && !win.isDestroyed() && !win.isVisible()) {
        forceShow('超时兜底');
      }
    }, 2000);
  };

  const checkAuthAndSyncOnly = async (): Promise<boolean> => {
    const DEBUG = process.env.SENSETYPE_MAIN_DEBUG === '1';
    const normalizeBearer = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return null;
      return /^bearer\s+/i.test(s) ? s : `Bearer ${s}`;
    };
    const COMMON_HEADERS: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-language': 'zh-cn',
      'x-platform': 'Windows',
      'x-version': '0.0.1',
      'x-product': 'SenseType',
    };

    const token = getToken();
    if (!token) return false;

    try {
      const authorization = normalizeBearer(token);
      if (DEBUG) {
        console.log('[auth-check-request][sync-only][debug] token exists:', {
          exists: !!authorization,
        });
      }
      const resp = await axios.get(`${MAIN_API_BASE_URL}/api/user/self`, {
        headers: {
          ...COMMON_HEADERS,
          ...(authorization ? { Authorization: authorization } : {}),
        },
        timeout: 15000,
      });
      const payload = resp?.data;
      const userInfo = payload?.data ?? payload;
      const hasUser =
        !!userInfo &&
        (typeof userInfo?.username === 'string' || typeof userInfo?.phone === 'string');
      if (hasUser) {
        setUserInfo(userInfo);
        return true;
      }
      return false;
    } catch (error: unknown) {
      const err = error as { response?: { status?: number } };
      const status = err?.response?.status;
      // 后台校验：只有明确 401/403 才清理本地登录态；不弹窗/不切路由
      if (status === 401 || status === 403) {
        try {
          clearAuthInStore();
        } catch {
          //
        }
        return false;
      }
      return false;
    }
  };

  const checkAuthAndShowWindow = async (): Promise<boolean> => {
    const DEBUG = process.env.SENSETYPE_MAIN_DEBUG === '1';
    const maskAuth = (v: unknown) => {
      const s = typeof v === 'string' ? v : '';
      if (!s) return { exists: false };
      const bearer = /^bearer\s+/i.test(s);
      const head = s.slice(0, 12);
      const tail = s.slice(-8);
      return { exists: true, bearer, length: s.length, head, tail };
    };
    const normalizeBearer = (v: unknown): string | null => {
      const s = typeof v === 'string' ? v.trim() : '';
      if (!s) return null;
      return /^bearer\s+/i.test(s) ? s : `Bearer ${s}`;
    };
    const COMMON_HEADERS: Record<string, string> = {
      'Content-Type': 'application/json',
      'x-language': 'zh-cn',
      'x-platform': 'Windows',
      'x-version': '0.0.1',
      'x-product': 'SenseType',
    };

    const token = getToken();
    console.log('启动免密检查：token', {
      exists: !!token,
      length: typeof token === 'string' ? token.length : 0,
    });

    if (!token) {
      console.log('没有 token，显示登录页（同一窗口）');
      showLoginWindow();
      return false;
    }

    console.log('检测到 token，主进程调用 getUser 校验 token...');
    // 移除：不要在校验期间隐藏窗口，避免用户看到“窗口闪现-消失-出现”的怪异现象
    // if (win && !win.isDestroyed()) win.hide();

    try {
      const authorization = normalizeBearer(token);
      if (DEBUG) {
        const fullUrl = `${MAIN_API_BASE_URL}/api/user/self`;
        console.log('[auth-check][debug] baseURL/url:', {
          MAIN_API_BASE_URL,
          url: '/api/user/self',
          fullUrl,
          Authorization: maskAuth(authorization),
          commonHeaders: COMMON_HEADERS,
        });
      }
      const resp = await axios.get(`${MAIN_API_BASE_URL}/api/user/self`, {
        headers: {
          ...COMMON_HEADERS,
          ...(authorization ? { Authorization: authorization } : {}),
        },
        timeout: 15000,
      });
      console.log(
        'getUser 返回:',
        {
          status: resp?.status,
          hasData: !!resp?.data,
        },
        resp?.data,
      );
      const payload = resp?.data;

      // 兼容两种常见结构：
      // 1) 直接返回 user 对象：{ username, phone, ... }
      // 2) 返回包装结构：{ success: true, data: { ...user } }
      const userInfo = payload?.data ?? payload;
      const hasUser =
        !!userInfo &&
        (typeof userInfo?.username === 'string' || typeof userInfo?.phone === 'string');

      if (hasUser) {
        // 保存用户信息到 electron-store（同时更新内存缓存）
        setUserInfo(userInfo);

        // 免密成功后：确保主窗口路由不是登录页
        // 无论当前 isLoading 与否，都在 did-finish-load 后再补一次，避免打包环境时序差导致路由没被纠正
        try {
          win?.webContents?.once?.('did-finish-load', ensureMainRoute);
        } catch {
          // ignore
        }
        ensureMainRoute();

        console.log('getUser 成功，进入主窗口');
        showMainWindowSafely();
        return true;
      }

      // getUser 返回的 payload 不包含用户信息：
      // 只有明确“未授权/无权限”才退回登录；否则（例如后端异常/网关返回非预期结构）不要强制登出。
      const embeddedStatus = (payload as any)?.error?.response?.status ?? (payload as any)?.status;
      if (embeddedStatus === 401 || embeddedStatus === 403) {
        console.log('getUser 返回未授权/无权限，进入登录窗口。payload:', payload);
        clearAuthInStore();
        showLoginWindow();
        return false;
      }

      console.warn(
        'getUser 返回非预期结构（非 401/403），保留 token，进入主窗口。payload:',
        payload,
      );
      showMainWindowSafely();
      return true;
    } catch (error: unknown) {
      const err = error as { response?: { status?: number }; message?: string };
      const status = err?.response?.status;
      console.error('getUser 请求失败:', status, err?.message || err);
      // 只有 getUser 明确返回未授权/无权限，才清 token 并进入登录
      // 其余网络/超时/5xx：不清 token，仍进入主窗口（避免“明明有 token 但网络抖一下就被迫重新登录”）
      if (status === 401 || status === 403) {
        clearAuthInStore();
        showLoginWindow();
        return false;
      }

      console.warn('getUser 校验失败但非 401/403，保留 token，进入主窗口');
      showMainWindowSafely();
      return true;
    }
  };

  const showLoginWindow = () => {
    // NOTE: 已移除独立登录窗口。登录页与主页面共用同一个主窗口。
    desiredTrayVisible = false;
    trayVisibilityCallback?.(false);

    // 确保主窗口存在
    if (!win || win.isDestroyed()) {
      createWindow();
      if (win) enable(win.webContents);
    }

    // 清理渲染侧 token，并切到 /login
    safeExecuteJavaScript(
      win,
      `(function(){try{localStorage.removeItem('Authorization');localStorage.removeItem('user_info');}catch(e){};try{window.location.hash='#/login';}catch(e){}})();`,
    );

    (async () => {
      try {
        await waitForRendererRouteReady(win, '/login', 2500);
      } finally {
        sendAppTransition(false);
      }
    })();

    showMainWindowSafely();
  };

  // 监听登录成功事件
  const handleLoginSuccess = () => {
    console.log('收到登录成功事件');

    // 已移除独立登录窗口：登录成功后只需确保主窗口路由为 "/"
    if (!win || win.isDestroyed()) {
      console.error('主窗口不存在或已销毁，无法处理登录成功');
      return;
    }

    try {
      if (win.isMinimized?.()) win.restore();
      ensureMainRoute();
      (async () => {
        sendAppTransition(false);
        await waitForRendererRouteReady(win, '/', 2500);
        showMainWindowSafely();
      })();
    } catch (error) {
      console.error('处理登录成功时出错:', error);
      showMainWindowSafely();
    }
  };

  const getLoginWindow = () => null;

  const createWindow = () => {
    // 如果窗口已存在且未销毁，先销毁它
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
    mainWindowReadyToShow = false;
    win = new BrowserWindow({
      minWidth: WINDOW_MIN_WIDTH,
      minHeight: WINDOW_MIN_HEIGHT,
      useContentSize: true,
      resizable: true,
      width: WINDOW_WIDTH,
      // Windows: 使用自绘标题栏（renderer 里的 WindowHeader）
      frame: false,
      title: 'sensetype',
      show: false, // 先不显示，等检查完token后再显示
      height: WINDOW_HEIGHT,
      // frame: false 时 titleBarStyle/titleBarOverlay 不生效（保留/移除都可）
      skipTaskbar: false,
      icon: getIconPath(),

      backgroundColor: '#fff',
      webPreferences: {
        webSecurity: false,
        backgroundThrottling: false,
        contextIsolation: false,
        webviewTag: true,
        nodeIntegration: true,
        // 生产包里 dist/ 在 app.asar 中：主进程 __dirname 通常是 app.asar/dist-electron/main
        // 因此用相对路径指向 app.asar/dist/preload.js
        preload: app.isPackaged
          ? path.join(__dirname, '../../dist/preload.js')
          : path.join(__dirname, '../../public/preload.js'),
        spellcheck: false,
        devTools: appConfig.devTools,
      },
    });

    // 只要保持 show:false，就不会“闪一下”；等 ready-to-show 再允许显示
    const createdWin = win;
    // const setRendererBackgroundThrottling = (throttle: boolean) => {
    //   try {
    //     if (!createdWin || createdWin.isDestroyed()) return;
    //     createdWin.webContents?.setBackgroundThrottling?.(throttle);
    //   } catch {
    //     // ignore
    //   }
    // };
    // 默认窗口前台使用不节流；隐藏到后台后开启节流，降低长期后台运行的系统负担
    // setRendererBackgroundThrottling(false);

    // Windows webContents fallback is disabled by default to avoid competing
    // with native keyhook event source and causing duplicate / out-of-order start-stop events.
    // Only enable for diagnostics when explicitly requested.
    const enableWebContentsHotkeyFallback =
      process.env.SENSETYPE_WIN_ENABLE_WEBCONTENTS_HOTKEY_FALLBACK === '1';
    if (process.platform === 'win32' && enableWebContentsHotkeyFallback) {
      let rAltDown = false;
      const pendingActionAfterLoad: { value: 'start' | 'stop' | null } = { value: null };
      let loadFlushAttached = false;
      const START_REPLAY_DELAYS_MS = [180, 520, 980, 1600, 2500, 3800, 5400, 7600];
      let startReplaySeq = 0;
      const startReplayTimers = new Set<NodeJS.Timeout>();
      const clearStartReplayTimers = () => {
        if (startReplayTimers.size === 0) return;
        for (const t of startReplayTimers) {
          try {
            clearTimeout(t);
          } catch {
            //
          }
        }
        startReplayTimers.clear();
      };
      const stopStartReplay = () => {
        startReplaySeq += 1;
        clearStartReplayTimers();
      };
      const sendGlobalRecordNow = (action: 'start' | 'stop') => {
        if (!createdWin || createdWin.isDestroyed()) return;
        const wc = createdWin.webContents;
        if (wc.isDestroyed()) return;
        if (wc.isLoading()) {
          // Best-effort immediate send while loading: listener可能已挂上。
          try {
            wc.send('global-record', { action });
            console.info(`[win32-webcontents-hotkey] sent global-record ${action}`);
          } catch {
            //
          }
          // 页面加载期间仅保留最后一个动作，避免 start/stop 监听堆积。
          pendingActionAfterLoad.value = action;
          if (loadFlushAttached) return;
          loadFlushAttached = true;
          wc.once('did-finish-load', () => {
            loadFlushAttached = false;
            const pending = pendingActionAfterLoad.value;
            pendingActionAfterLoad.value = null;
            if (!pending) return;
            try {
              if (!createdWin || createdWin.isDestroyed() || wc.isDestroyed()) return;
              wc.send('global-record', { action: pending });
              console.info(`[win32-webcontents-hotkey] flushed global-record ${pending}`);
            } catch {
              //
            }
          });
          return;
        }
        try {
          wc.send('global-record', { action });
          console.info(`[win32-webcontents-hotkey] sent global-record ${action}`);
        } catch {
          //
        }
      };
      const scheduleStartReplay = () => {
        // 仅在页面加载阶段做 start 重放兜底；正常运行时避免连续 start 干扰状态。
        try {
          if (!createdWin || createdWin.isDestroyed()) return;
          const wc = createdWin.webContents;
          if (wc.isDestroyed() || !wc.isLoading()) return;
        } catch {
          return;
        }
        clearStartReplayTimers();
        const seq = ++startReplaySeq;
        for (const delay of START_REPLAY_DELAYS_MS) {
          const timer = setTimeout(() => {
            startReplayTimers.delete(timer);
            if (seq !== startReplaySeq) return;
            if (!rAltDown) return;
            try {
              if (!createdWin || createdWin.isDestroyed()) return;
              const wc = createdWin.webContents;
              if (wc.isDestroyed() || !wc.isLoading()) return;
            } catch {
              return;
            }
            sendGlobalRecordNow('start');
          }, delay);
          try {
            (timer as unknown as { unref?: () => void }).unref?.();
          } catch {
            //
          }
          startReplayTimers.add(timer);
        }
      };
      const sendGlobalRecord = (action: 'start' | 'stop') => {
        try {
          // 按下语音唤起键：自动收起重写悬浮窗，避免遮挡/抢焦点
          if (action === 'start') {
            try {
              hideRewriteOverlay();
            } catch {
              // ignore
            }
          }

          // Windows优化: 允许webContents发送start事件，但避免与native hook重复
          // 只有在native hook刚刚发送过start事件的情况下才跳过（避免重复）
          try {
            const s = getHoldRecorderStatus();
            if (s?.backend === 'native' && action === 'start' && s?.lastEventType === 'start') {
              const timeSinceLastStart = Date.now() - (s?.lastEventAt || 0);
              if (timeSinceLastStart < 200) return; // 200ms内的重复start跳过
            }
          } catch {
            // ignore
          }

          // Avoid duplicating native hook events (prevents start/stop race in renderer).
          try {
            const s = getHoldRecorderStatus();
            if (s?.lastEventType === action && typeof s?.lastEventAt === 'number') {
              if (Date.now() - s.lastEventAt < 250) return;
            }
          } catch {
            // ignore
          }

          if (action === 'start') {
            sendGlobalRecordNow('start');
            scheduleStartReplay();
          } else {
            stopStartReplay();
            sendGlobalRecordNow('stop');
          }

          // Safety valve (win32 only):
          // When the app window eats AltRight keyUp, native hook state can lag behind and keep modifiers/swallow state stuck,
          // making the next press require an extra "tap" to recover. Force-reset native state on STOP from this fallback path.
          if (action === 'stop') {
            try {
              const keyhook = tryLoadKeyhook<{ forceReset?: () => boolean }>();
              if (typeof keyhook?.forceReset === 'function') {
                keyhook.forceReset();
              }
            } catch {
              // ignore
            }
          }
        } catch {
          //
        }
      };

      createdWin.webContents.on('before-input-event', (event, input) => {
        try {
          // 该 fallback 仅用于 Right Alt 长按录音；其它按键由原生 keyhook 处理。
          if (getHoldToRecordConfig().winKey !== 'ralt') return;
          if (input?.code !== 'AltRight') return;
          if (input.type === 'keyDown') {
            // Ignore repeats; treat as a hold key.
            if (!rAltDown) {
              rAltDown = true;
              sendGlobalRecord('start');
            }
            startPoll();
            event.preventDefault();
          } else if (input.type === 'keyUp') {
            // Some environments won't deliver keyUp reliably; stop is primarily driven by polling below.
            stopPoll();
            rAltDown = false;
            sendGlobalRecord('stop');
            event.preventDefault();
          }
        } catch {
          //
        }
      });

      // Some Windows environments won't deliver AltRight keyUp to the focused window at all.
      // To avoid "stuck recording until blur", poll physical key state after keyDown.
      let pollTimer: NodeJS.Timeout | null = null;
      let releasedStreak = 0;
      const stopPoll = () => {
        if (pollTimer) {
          clearInterval(pollTimer);
          pollTimer = null;
        }
        releasedStreak = 0;
      };
      const startPoll = () => {
        if (pollTimer) return;
        releasedStreak = 0;
        pollTimer = setInterval(() => {
          try {
            if (!rAltDown) {
              stopPoll();
              return;
            }
            const keyhook = tryLoadKeyhook<{ isHoldDown?: () => boolean }>();
            const down = typeof keyhook?.isHoldDown === 'function' ? !!keyhook.isHoldDown() : true;
            if (down) {
              releasedStreak = 0;
              return;
            }
            // require 2 consecutive "up" reads to avoid flicker
            releasedStreak += 1;
            if (releasedStreak >= 2) {
              rAltDown = false;
              stopPoll();
              sendGlobalRecord('stop');
            }
          } catch {
            // If polling fails, don't keep recording stuck.
            if (rAltDown) {
              rAltDown = false;
              stopPoll();
              sendGlobalRecord('stop');
            }
          }
        }, 35);
        try {
          (pollTimer as unknown as { unref?: () => void })?.unref?.();
        } catch {
          //
        }
      };

      // If window loses focus while holding the key, force-stop to avoid "stuck recording".
      createdWin.on('blur', () => {
        if (!rAltDown) return;
        rAltDown = false;
        stopPoll();
        stopStartReplay();
        sendGlobalRecord('stop');
      });
    }
    createdWin.hide();
    createdWin.once('ready-to-show', () => {
      mainWindowReadyToShow = true;
      if (pendingShowMainWindow) {
        // 如果外部已经请求过显示，这里补一次
        try {
          if (!createdWin.isDestroyed()) createdWin.show();
          createdWin.focus();
          trayVisibilityCallback?.(true);
        } catch (e) {
          console.error('ready-to-show 后显示主窗口失败:', e);
        }
      }
    });

    if (process.env.VITE_DEV_SERVER_URL) {
      createdWin.loadURL(process.env.VITE_DEV_SERVER_URL as string);
    } else {
      // 生产包里 dist/index.html 在 app.asar/dist/index.html
      createdWin.loadFile(join(__dirname, '../../dist/index.html'));
    }

    if (appConfig.devTools) {
      globalShortcut.register('CommandOrControl+Shift+i', () => {
        if (win && !win.isDestroyed()) win.webContents.openDevTools();
      });
    }
    // Windows: 自绘窗口为了贴合 UI 关闭阴影
    win.setHasShadow(false);
    win.setMenuBarVisibility(false);
    // 确保窗口隐藏时渲染进程仍然活跃，能够接收 IPC 消息
    win.webContents.on('did-finish-load', () => {
      // 窗口加载完成后，确保可以接收消息
    });
    win.on('close', (e) => {
      // 真正退出时才允许关闭窗口
      if (isQuitting) return;
      // 默认点击关闭仅隐藏到托盘，保持应用后台运行
      // 这样托盘图标、全局热键等功能可以继续工作
      e.preventDefault();
      win?.hide();
      // 确保窗口隐藏后仍然可以接收消息和处理事件
      if (win?.webContents) {
        console.log('[Window] 窗口已隐藏到托盘，保持后台运行');
      }
    });
    win.on('closed', () => {
      // 只有在真正退出时才清理窗口引用
      // 如果只是隐藏窗口，保持窗口对象存在以便后台运行
      if (isQuitting) {
        console.log('[Window] 应用退出，清理窗口引用');
        win = undefined;
      }
    });
    // win.on('hide', () => {
    //   // 窗口隐藏事件已记录，主进程会通过定期检查来处理钩子状态
    //   // 这里不做任何操作，避免阻塞窗口隐藏流程
    //   // Win: 后台节流会导致渲染线程/定时器暂停，导致语音指令发不出来，必须保持 false
    //   setRendererBackgroundThrottling(false);
    // });
    // win.on('minimize', () => setRendererBackgroundThrottling(false));
  };

  const getWindow = () => win;

  const getOrCreateWindow = (hideAfterCreate = true): BrowserWindow => {
    if (!win || win.isDestroyed()) {
      // 创建窗口但不显示，保持后台运行
      createWindow();
      if (!win) {
        throw new Error('无法创建主窗口');
      }
      enable(win.webContents);
      // 如果指定隐藏，则隐藏窗口
      if (hideAfterCreate) {
        win?.hide();
      }
    }
    if (!win) {
      throw new Error('主窗口不存在');
    }
    return win;
  };

  const setTrayVisibilityCallback = (callback: (visible: boolean) => void) => {
    trayVisibilityCallback = callback;
    // 回放最新的“期望托盘可见状态”，避免回调注册时序导致托盘永远不创建
    try {
      trayVisibilityCallback(desiredTrayVisible);
    } catch (e) {
      console.error('回放托盘可见状态失败:', e);
    }
  };

  return {
    init,
    getWindow,
    getOrCreateWindow,
    getLoginWindow,
    setTrayVisibilityCallback,
  };
};
