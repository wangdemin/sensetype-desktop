'use strict';
import {
  app,
  globalShortcut,
  protocol,
  BrowserWindow,
  ipcMain,
  Tray,
  Notification,
  shell,
  session,
  desktopCapturer,
  powerMonitor,
  dialog,
} from 'electron';
import path from 'path';
import main from '../browsers/main.win';
import createTray from '../browsers/trayConfig';
import { getHoldRecorderStatus, registerGlobalHoldRecorder } from './globalRecorderHotkey';
import { loadKeyhookOrThrow } from './keyhookLoader';
import { pasteTextToActiveApp } from './pasteToActiveApp';
import { readSelectedTextFromActiveApp } from './copyFromActiveApp';
import {
  getAutoLaunchEnabled,
  getHoldToRecordConfig,
  getToggleToRecordConfig,
  getPreferredLanguageVariant,
  getPreferredMicDeviceId,
  getSystemPromptSoundEnabled,
  setAutoLaunchEnabled,
  setHoldToRecordConfig,
  setToggleToRecordConfig,
  setPreferredLanguageVariant,
  setPreferredMicDeviceId,
  setSystemPromptSoundEnabled,
} from '../common/settingsStore';
import {
  describeHoldKeyLabel,
  normalizeToggleToRecordConfig,
  validateHoldKey,
  validateToggleAccelerator,
} from '../../common/hotkeyRules';

function describeHoldKeyForPlatform(): string {
  const cfg = getHoldToRecordConfig();
  return describeHoldKeyLabel('win', cfg.winKey);
}
import {
  hideRewriteOverlay,
  setRewriteOverlayEditable,
  setRewriteOverlayHovered,
  showRewriteOverlay,
  showRewriteOverlayAndWait,
  preloadRewriteOverlay,
} from './rewriteOverlayWindow';
import {
  ensureVoiceIndicatorWindow,
  resizeVoiceIndicatorWindow,
  updateVoiceIndicator,
} from '../common/voiceIndicatorWindow';
import { registerRequestHandlers } from '../ipc/request';
import { registerTokenStoreHandlers } from '../ipc/tokenStore';
import { registerRecordingsHandlers } from '../ipc/recordings';
import { registerAvatarHandlers } from '../ipc/avatar';
import { setupStickyNoteIpc } from '../browsers/stickyNote';
import { loadDevEnvOnce } from '../common/loadDevEnv';
import {
  getToken as getAuthToken,
  clearAuth as clearAuthInMain,
  setToken as setAuthToken,
  setUserInfo as setAuthUserInfo,
} from '../common/authCache';
import { setGlobalRecordListenerReady } from '../common/globalRecordDispatcher';

process.env['ELECTRON_DISABLE_SECURITY_WARNINGS'] = 'true';
try {
  if (!app.isPackaged) loadDevEnvOnce();
} catch {
  // ignore
}
class ElectronMain {
  public windowCreator!: {
    init: () => void;
    getWindow: () => BrowserWindow | undefined;
    getOrCreateWindow?: () => BrowserWindow;
    getLoginWindow?: () => BrowserWindow | null;
    setTrayVisibilityCallback?: (callback: (visible: boolean) => void) => void;
  };
  private systemPlugins: any;
  private disposeGlobalHotkey?: () => void;
  private reRegisterGlobalHotkey?: (reason?: string) => void;
  private tray?: Tray;
  private trayCreating?: Promise<Tray>;
  private pendingDeepLinkUrl: string | null = null;
  private pendingUserRefreshPayload: { reason: string; url?: string } | null = null;

  private extractDeepLinkFromArgv(argv: string[]): string | null {
    try {
      for (const a of argv || []) {
        const s = String(a || '');
        if (s.startsWith('sensetype-client://') || s.startsWith('sensetype-client://')) return s;
      }
    } catch {
      // ignore
    }
    return null;
  }

  private extractTokenFromDeepLinkUrl(urlStr: string): string | null {
    try {
      const u = new URL(String(urlStr));
      const token =
        u.searchParams.get('token') ||
        u.searchParams.get('access_token') ||
        u.searchParams.get('Authorization') ||
        u.searchParams.get('auth');
      if (token && token.trim()) return token.trim();

      const hash = String(u.hash || '').replace(/^#\??/, '');
      if (hash) {
        const hp = new URLSearchParams(hash);
        const t =
          hp.get('token') || hp.get('access_token') || hp.get('Authorization') || hp.get('auth');
        if (t && t.trim()) return t.trim();
      }
    } catch {
      // ignore
    }
    return null;
  }

  private shouldRefreshUserInfoFromDeepLink(urlStr: string): boolean {
    try {
      const u = new URL(String(urlStr));
      const fromSearch = u.searchParams.get('launch');
      if (String(fromSearch || '').trim() === '2') return true;

      const hash = String(u.hash || '').replace(/^#\??/, '');
      if (hash) {
        const hp = new URLSearchParams(hash);
        const fromHash = hp.get('launch');
        if (String(fromHash || '').trim() === '2') return true;
      }
    } catch {
      // ignore
    }
    return false;
  }

  private broadcastUserRefreshRequest(payload: { reason: string; url?: string }): void {
    try {
      const wins = BrowserWindow.getAllWindows();
      if (!wins.length) {
        this.pendingUserRefreshPayload = payload;
        return;
      }
      for (const w of wins) {
        try {
          w.webContents.send('user-refresh-request', payload);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
      this.pendingUserRefreshPayload = payload;
    }
  }

  private flushPendingUserRefreshRequest(): void {
    const payload = this.pendingUserRefreshPayload;
    if (!payload) return;
    this.pendingUserRefreshPayload = null;
    this.broadcastUserRefreshRequest(payload);
  }

  private handleDeepLinkUrl(urlStr: string) {
    // launch=2：只要收到 deep link，就触发一次“刷新用户信息”（不依赖是否携带 token）
    try {
      if (this.shouldRefreshUserInfoFromDeepLink(urlStr)) {
        this.broadcastUserRefreshRequest({
          reason: 'deep-link-launch-2',
          url: String(urlStr || ''),
        });
      }
    } catch {
      // ignore
    }

    const token = this.extractTokenFromDeepLinkUrl(urlStr);
    if (!token) return;

    // 换号：先清理旧登录态，再写入新 token（避免旧 userInfo 残留/串号）
    try {
      clearAuthInMain();
    } catch {
      // ignore
    }
    try {
      setAuthToken(token);
      // 先显式清空 userInfo，后续再通过 auth-check-request 拉取 /api/user/self
      setAuthUserInfo(null);
    } catch {
      // ignore
    }

    const win =
      this.windowCreator?.getOrCreateWindow?.() ?? this.windowCreator?.getWindow?.() ?? null;
    if (win && !win.isDestroyed()) {
      try {
        if (win.isMinimized?.()) win.restore();
      } catch {
        // ignore
      }
      try {
        win.show();
        win.focus();
      } catch {
        // ignore
      }
      try {
        const js = `(function(){try{localStorage.removeItem('Authorization');localStorage.removeItem('user_info');}catch(e){};try{localStorage.setItem('Authorization',${JSON.stringify(
          token,
        )});}catch(e){};try{window.location.hash='#/';}catch(e){};try{window.electronAPI?.ipcRenderer?.send?.('auth-check-request',{show:true,reason:'deep-link-token'});}catch(e){};})();`;
        win.webContents?.executeJavaScript(js).catch(() => {
          // ignore
        });
      } catch {
        // ignore
      }
    }

    try {
      // 先广播 token，userInfo 置空；随后 auth-check-request 会拉取 user/self 并再次广播
      const payload = { token: getAuthToken(), userInfo: null };
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          w.webContents.send('auth-changed', payload);
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  }

  constructor() {
    protocol.registerSchemesAsPrivileged([
      { scheme: 'app', privileges: { secure: true, standard: true } },
    ]);
    const gotTheLock = app.requestSingleInstanceLock();
    if (!gotTheLock) {
      // 关键：不要在“第二实例”里初始化任何窗口/IPC/原生模块。
      // 开发模式误启动时，如果这里做了初始化，可能会影响已运行的打包版本（例如全局钩子状态）。
      try {
        app.exit(0);
      } catch {
        app.quit();
      }
    } else {
      app.on('second-instance', (_event, argv) => {
        try {
          const deepLink = this.extractDeepLinkFromArgv(argv || []);
          if (deepLink) this.handleDeepLinkUrl(deepLink);
        } catch {
          // ignore
        }
      });

      this.windowCreator = main();
      this.beforeReady();
      this.onReady();
      this.onRunning();
      this.onQuit();
    }
  }
  beforeReady() {
    // 默认启用硬件加速（提升输入/滚动/动画流畅度）。
    // 仅在遇到 GPU/驱动兼容问题时，才通过环境变量显式关闭：
    // SENSETYPE_DISABLE_HW_ACCEL=1
    if (process.env.SENSETYPE_DISABLE_HW_ACCEL === '1') {
      app.disableHardwareAcceleration();
      console.warn('[main] Hardware acceleration disabled by SENSETYPE_DISABLE_HW_ACCEL=1');
    }
  }

  createWindow() {
    this.windowCreator.init();
  }
  onReady() {
    app.on('ready', async () => {
      // 注册自定义协议：senseType-client://（用于网页登录回跳携带 token）
      try {
        const scheme = 'sensetype-client';
        if (app.isPackaged) {
          app.setAsDefaultProtocolClient(scheme);
        } else {
          const appPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
          app.setAsDefaultProtocolClient(scheme, process.execPath, appPath ? [appPath] : []);
        }
      } catch (e) {
        console.warn('[protocol] Failed to register deep link protocol:', e);
      }

      const applyAutoLaunch = (enabled: boolean) => {
        try {
          // 开发态避免污染系统登录项；打包后生效即可
          if (!app.isPackaged) return;
          app.setLoginItemSettings({
            openAtLogin: enabled,
            openAsHidden: true,
            path: process.execPath,
            args: ['--autostart'],
          });
        } catch (e) {
          console.warn('[main] Failed to apply auto-launch settings:', e);
        }
      };

      // Forward renderer logs to main process (terminal output).
      // Useful when DevTools console isn't open / visible.
      try {
        ipcMain.removeAllListeners('renderer-log');
        ipcMain.on('renderer-log', (_event, payload: unknown) => {
          try {
            console.log('[renderer]', payload);
          } catch {
            console.log('[renderer]');
          }
        });
      } catch {
        //
      }
      try {
        ipcMain.removeAllListeners('global-record-listener-state');
        ipcMain.on('global-record-listener-state', (event, payload: { ready?: boolean }) => {
          try {
            setGlobalRecordListenerReady(event.sender, payload?.ready !== false);
          } catch {
            // ignore
          }
        });
      } catch {
        //
      }

      // Legacy preload bridge: public/dist `preload.js` still uses ipcRenderer.sendSync('msg-trigger', ...).
      // If main process doesn't handle it and set event.returnValue synchronously, renderer will hard-freeze.
      // We implement a minimal safe handler:
      // - supports a few harmless operations
      // - returns Error for unknown types (preload will throw instead of freezing)
      ipcMain.on('msg-trigger', (event, payload: { type?: string; data?: any }) => {
        try {
          const type = String(payload?.type || '');
          const data = payload?.data;
          const win = this.windowCreator?.getWindow?.();

          if (type === 'hideMainWindow') {
            try {
              win?.hide?.();
            } catch {
              //
            }
            event.returnValue = true;
            return;
          }
          if (type === 'showMainWindow') {
            try {
              if (win && !win.isDestroyed()) {
                win.show();
                win.focus();
              }
            } catch {
              //
            }
            event.returnValue = true;
            return;
          }
          if (type === 'showOpenDialog') {
            // Use overload without BrowserWindow to avoid strict typing issues when win is undefined.
            const result = dialog.showOpenDialogSync(data ?? {});
            event.returnValue = {
              canceled: !result || result.length === 0,
              filePaths: result || [],
            };
            return;
          }
          if (type === 'showSaveDialog') {
            const result = dialog.showSaveDialogSync(data ?? {});
            event.returnValue = { canceled: !result, filePath: result || null };
            return;
          }
          if (type === 'shellBeep') {
            try {
              if (getSystemPromptSoundEnabled()) shell.beep();
            } catch {
              //
            }
            event.returnValue = true;
            return;
          }
          if (type === 'showNotification') {
            try {
              if (Notification.isSupported()) {
                const body = typeof data?.body === 'string' ? data.body : String(data?.body || '');
                new Notification({ title: 'SenseAudio输入法', body }).show();
              }
            } catch {
              //
            }
            event.returnValue = true;
            return;
          }

          event.returnValue = new Error(`[msg-trigger] Unsupported type: ${type}`);
        } catch (e: any) {
          event.returnValue = e instanceof Error ? e : new Error(String(e));
        }
      });

      // Chromium permission bridge:
      // - 为 getUserMedia(audio) 放行 renderer 的 permission 请求（真正的系统级权限仍由 OS 控制）
      try {
        const ses = session.defaultSession;
        ses.setPermissionRequestHandler((webContents, permission, callback, details: any) => {
          try {
            if (permission === 'media') {
              const mediaTypes: string[] = Array.isArray(details?.mediaTypes)
                ? details.mediaTypes
                : [];
              const wantsAudio = mediaTypes.length === 0 || mediaTypes.includes('audio');
              if (wantsAudio) return callback(true);
            }
            if (permission === 'display-capture') return callback(true);
          } catch {
            // ignore
          }
          callback(false);
        });

        ses.setDisplayMediaRequestHandler(async (request, callback) => {
          try {
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            const first = sources && sources[0] ? sources[0] : null;
            if (!first) return callback({});
            callback({
              video: first,
              // Windows: allow system audio loopback when requested
              ...(request.audioRequested ? { audio: 'loopback' } : {}),
            });
          } catch {
            callback({});
          }
        });
      } catch (e) {
        console.warn('[permission] Failed to set permission request handler:', e);
      }

      // Windows: 注册 IPC / 创建窗口
      registerRequestHandlers();
      registerTokenStoreHandlers();
      registerRecordingsHandlers();
      registerAvatarHandlers();
      setupStickyNoteIpc();
      // Windows优化: 在UI初始化前异步预加载原生模块，提升热键注册速度
      setImmediate(() => {
        try {
          // 异步预加载keyhook模块，不阻塞主线程
          loadKeyhookOrThrow();
          console.info('[main] Windows: native keyhook module preloaded');
        } catch (e) {
          console.error('[main] Windows: failed to preload native keyhook module:', e);
        }
      });

      // 先注册 IPC（尤其是 token-store-* 的 sendSync），再创建窗口，避免渲染进程启动早于 handler 导致读不到 token/userInfo
      this.createWindow();
      // 若 deep link 在窗口创建前触发（argv），这里补发一次 pending 的 refresh 请求
      this.flushPendingUserRefreshRequest();
      // 启动时应用一次"开机自启"设置（macOS/Windows 都走 setLoginItemSettings）
      applyAutoLaunch(getAutoLaunchEnabled());

      // 首次启动若 argv 带了 deep link，ready 后补处理一次
      try {
        this.pendingDeepLinkUrl = this.extractDeepLinkFromArgv(process.argv || []);
        if (this.pendingDeepLinkUrl) this.handleDeepLinkUrl(this.pendingDeepLinkUrl);
      } catch {
        // ignore
      }

      // 登录窗口右上角 X：渲染进程会发出 app-quit，这里统一处理为退出应用
      ipcMain.on('app-quit', () => {
        try {
          app.quit();
        } catch {
          // ignore
        }
      });

      // 托盘仅在“主窗口阶段”创建；登录窗口阶段不显示托盘（也不创建）
      // 必须持有 Tray 引用，否则可能被 GC 回收，导致右键菜单/点击事件失效（mac 上尤其常见）
      const setTrayVisible = (visible: boolean) => {
        try {
          if (!visible) {
            if (this.tray && !this.tray.isDestroyed()) {
              this.tray.removeAllListeners();
              this.tray.destroy();
            }
            this.tray = undefined;
            this.trayCreating = undefined;
            return;
          }

          // visible === true：确保托盘存在
          if (this.tray && !this.tray.isDestroyed()) return;
          if (this.trayCreating) return;
          if (!this.windowCreator?.getLoginWindow) return;

          this.trayCreating = createTray({
            getWindow: () => this.windowCreator.getWindow(),
            getLoginWindow: () => this.windowCreator.getLoginWindow?.() || null,
            getOrCreateWindow: () => {
              if (this.windowCreator.getOrCreateWindow) {
                const win = this.windowCreator.getOrCreateWindow();
                if (win) return win;
              }
              throw new Error('windowCreator.getOrCreateWindow() is unavailable');
            },
            // 托盘点击是用户“回到电脑”后的高频入口：这里先做一次热键自愈兜底
            onBeforeShow: () => {
              try {
                this.reRegisterGlobalHotkey?.('tray-before-show');
              } catch (e) {
                console.warn('[main] tray-before-show hotkey re-register failed:', e);
              }
            },
          })
            .then((tray) => {
              this.tray = tray;
              return tray;
            })
            .finally(() => {
              this.trayCreating = undefined;
            });
        } catch (e) {
          console.error('切换托盘可见状态失败:', e);
        }
      };

      // 由 windowCreator（main.ts）在“显示主窗口/显示登录窗口”时回调控制托盘创建/销毁
      if (this.windowCreator?.setTrayVisibilityCallback) {
        this.windowCreator.setTrayVisibilityCallback(setTrayVisible);
      } else {
        // 兼容：如果没有回调能力，保持旧逻辑（默认创建一次）
        setTrayVisible(true);
      }
      // 全局 Alt 录音热键（跨应用）——通过 iohook 监听键盘，转发给渲染进程
      // 传入函数，确保窗口关闭后热键仍能正常工作，但不显示窗口
      const getOrCreateWindowForHotkey = () => {
        let win = this.windowCreator.getWindow();
        if (win && !win.isDestroyed()) {
          // 窗口存在且未销毁，直接返回（不显示）
          return win;
        }
        // 窗口不存在或已销毁，重新创建但不显示
        console.info('[global-alt-recorder] window not found, creating hidden window...');
        if (this.windowCreator.getOrCreateWindow) {
          win = this.windowCreator.getOrCreateWindow();
          // 确保窗口保持隐藏状态
          if (win && !win.isDestroyed() && win.isVisible()) {
            win.hide();
          }
          return win;
        }
        throw new Error('windowCreator.getOrCreateWindow() is unavailable');
      };

      // 注册热键的函数，可以在权限恢复后重新调用
      // 录音状态：用于避免“周期性重注册热键”在长按录音过程中把 hook 停掉，导致松开时无法 stop。
      let voiceSessionActive = false;
      let pendingHotkeyReRegister = false;
      let lastVoiceFeedbackAt = 0;
      let voiceSessionActiveSince = 0;
      let comboRecordingActive = false;
      let disposeToggleToRecordShortcut: (() => void) | undefined;
      // inject-text 专用：标记"本轮录音结束后是否需要做一次 forceReset"。
      // 只在录音停止后的第一次 inject-text 时执行一次 forceReset，
      // 避免逐 token 注入时每次都发送 11 个修饰键 key-up 事件干扰 IME（微信/钉钉丢字根因）。
      let injectNeedsForceReset = true;

      const clearToggleToRecordShortcut = () => {
        try {
          disposeToggleToRecordShortcut?.();
        } catch {
          //
        }
        disposeToggleToRecordShortcut = undefined;
      };

      const doRegisterHotkey = (reason: string) => {
        const cfg = getHoldToRecordConfig();
        const key = cfg.winKey;
        const holdValidation = validateHoldKey('win', key);
        if (holdValidation.blockedReasons.length > 0) {
          console.warn('[main] skip hold hotkey register due to invalid key:', {
            key,
            reasons: holdValidation.blockedReasons,
          });
          return Promise.resolve();
        }
        console.info('[main] registering hold-to-record hotkey:', {
          platform: process.platform,
          key,
          delayMs: cfg.delayMs,
          comboEnabled: true,
          cfg,
          reason,
        });
        const registerAllHotkeys = () => {
          this.disposeGlobalHotkey = registerGlobalHoldRecorder(getOrCreateWindowForHotkey, {
            key,
            delayMs: cfg.delayMs,
            comboEnabled: true,
            reason,
          });
          clearToggleToRecordShortcut();
        };
        // 先清理旧的热键（确保完全停止）
        if (this.disposeGlobalHotkey) {
          try {
            this.disposeGlobalHotkey();
            this.disposeGlobalHotkey = undefined; // 立即清空引用，防止重复调用
            clearToggleToRecordShortcut();
            comboRecordingActive = false;
            // 等待一点时间确保完全清理（避免 stop/start 过于紧密导致状态异常）
            // 使用 setTimeout 异步等待，不阻塞主线程
            return new Promise<void>((resolve) => {
              setTimeout(() => {
                try {
                  registerAllHotkeys();
                  resolve();
                } catch (error) {
                  console.error('[main] Error registering new hotkey:', error);
                  resolve();
                }
              }, 100);
            });
          } catch (error) {
            console.warn('[main] Error disposing old hotkey:', error);
            // 即使 dispose 失败，也尝试注册新的（可能旧的热键已经没有运行了）
            try {
              registerAllHotkeys();
            } catch (registerError) {
              console.error(
                '[main] Error registering new hotkey after dispose error:',
                registerError,
              );
            }
            return Promise.resolve();
          }
        } else {
          // 没有旧的热键，直接注册新的
          registerAllHotkeys();
          return Promise.resolve();
        }
      };

      let isRegisteringHotkey = false; // 防止并发注册
      let queuedHotkeyReRegisterReason: string | null = null;
      const registerHotkey = async (reason = 'manual') => {
        // 防止 voiceSessionActive 卡死导致永远无法自愈（比如渲染进程卡住/窗口关闭导致不再回传 voice-feedback）
        if (voiceSessionActive) {
          const now = Date.now();
          // 如果超过 90 秒没有收到任何 voice-feedback，就认为状态不可信，允许重注册
          if (lastVoiceFeedbackAt && now - lastVoiceFeedbackAt > 90_000) {
            console.warn(
              '[main] voiceSessionActive seems stale (no voice-feedback for >90s), forcing unlock for hotkey re-register. reason:',
              reason,
            );
            voiceSessionActive = false;
            pendingHotkeyReRegister = false;
            queuedHotkeyReRegisterReason = null;
            voiceSessionActiveSince = 0;
          }
        }
        if (voiceSessionActive) {
          pendingHotkeyReRegister = true;
          queuedHotkeyReRegisterReason = reason;
          console.info(
            '[main] hotkey re-register requested but voice session active; will retry after stop. reason:',
            reason,
          );
          return;
        }
        if (isRegisteringHotkey) {
          // 关键修复：注册进行中时不要丢弃请求，标记为 pending，当前轮结束后再补一次。
          pendingHotkeyReRegister = true;
          queuedHotkeyReRegisterReason = reason;
          console.info(
            '[main] hotkey registration already in progress, queueing one retry after current cycle. reason:',
            reason,
          );
          return;
        }
        isRegisteringHotkey = true;
        try {
          await doRegisterHotkey(reason);
        } catch (error) {
          console.error('[main] Error in registerHotkey:', error);
        } finally {
          isRegisteringHotkey = false;
          if (!voiceSessionActive && pendingHotkeyReRegister) {
            const nextReason = queuedHotkeyReRegisterReason || 'pending-after-registering';
            pendingHotkeyReRegister = false;
            queuedHotkeyReRegisterReason = null;
            try {
              console.info('[main] applying queued hotkey re-register after current cycle...');
              setTimeout(() => {
                void registerHotkey(`pending:${nextReason}`);
              }, 0);
            } catch (e) {
              console.warn('[main] Failed to apply queued hotkey re-register:', e);
            }
          }
        }
      };

      // 延迟注册热键，避免阻塞启动流程，提升首次响应速度
      // Windows平台下，原生模块加载+热键注册可能耗时500-1000ms
      this.reRegisterGlobalHotkey = registerHotkey;
      setTimeout(() => {
        registerHotkey('startup-delayed');
      }, 300); // 延迟300ms注册，给UI更多启动时间

      // Windows: 禁用 Alt+Tab 切换快捷键
      // NOTE(win32): 不再用 globalShortcut 试图拦截 Alt+Tab。
      // - 它对系统级快捷键并不可靠，且可能引入额外冲突。
      // - “按住说话期间防止触发其它快捷键”的能力应由底层 keyhook 吞键完成。

      // 轻量级钩子状态检查函数（异步，不阻塞）
      const DISABLED_AUTO_RETRY_MS = 60_000; // 原生模块缺失/加载失败时，最多每 60s 尝试一次
      let lastDisabledAutoRetryLogAt = 0;
      const checkHotkeyStatusLightweight = () => {
        // 使用 setTimeout 确保异步执行，不阻塞主线程
        setTimeout(() => {
          try {
            // 避免在 dispose/start 的短窗口里再触发新一轮重注册，造成状态抖动。
            if (isRegisteringHotkey) return;
            const status = getHoldRecorderStatus();
            // 如果钩子未运行且不是禁用状态，尝试重启
            if (status.backend === 'native' && status.nativeIsRunning === false) {
              console.info('[main] window hidden: hotkey not running, attempting restart...');
              // 重置状态，确保重启不被阻止
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
              queuedHotkeyReRegisterReason = null;
              registerHotkey('window-hidden-check');
            } else if (status.backend === 'disabled') {
              // 如果完全禁用，也尝试重启；但当原生模块缺失/加载失败时要退避，避免刷屏与无意义重试
              const now = Date.now();
              const lastRestartAt =
                typeof status.lastRestartAt === 'number' ? status.lastRestartAt : 0;
              const lastError = typeof status.lastError === 'string' ? status.lastError : '';
              const looksLikeMissingNative =
                lastError.includes('native keyhook not available') ||
                lastError.includes('MODULE_NOT_FOUND') ||
                lastError.includes('ERR_DLOPEN_FAILED') ||
                lastError.includes('The specified module could not be found') ||
                lastError.includes('找不到指定的模块');

              if (looksLikeMissingNative && now - lastRestartAt < DISABLED_AUTO_RETRY_MS) {
                if (now - lastDisabledAutoRetryLogAt > DISABLED_AUTO_RETRY_MS) {
                  lastDisabledAutoRetryLogAt = now;
                  console.warn(
                    '[main] hotkey disabled due to native keyhook load failure; backing off auto-retry. lastError:',
                    lastError,
                  );
                }
                return;
              }

              console.info('[main] window hidden: hotkey disabled, attempting restart...');
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
              queuedHotkeyReRegisterReason = null;
              registerHotkey('window-hidden-check');
            }
          } catch (e) {
            // 静默失败，不影响其他功能
            console.warn('[main] Failed to check hotkey status on window hide:', e);
          }
        }, 300); // 延迟 300ms，避免在窗口隐藏过程中立即检查
      };

      // 监听窗口隐藏事件（通过 windowCreator 获取窗口）
      // 注意：这里使用一个轻量级的检查，避免频繁操作
      let lastWindowHideCheck = 0;
      const WINDOW_HIDE_CHECK_COOLDOWN = 3000; // 3秒内最多检查一次

      // 通过定期检查窗口状态来触发钩子检查（轻量级，不频繁）
      setInterval(() => {
        try {
          const win = this.windowCreator.getWindow();
          if (win && !win.isDestroyed() && !win.isVisible()) {
            // 窗口隐藏，且距离上次检查超过冷却时间
            const now = Date.now();
            if (now - lastWindowHideCheck > WINDOW_HIDE_CHECK_COOLDOWN) {
              lastWindowHideCheck = now;
              checkHotkeyStatusLightweight();
            }
          }
        } catch {
          // 静默失败
        }
      }, 5000); // 每5秒检查一次窗口状态（不频繁，避免性能问题）

      // NOTE(win-branch): 这个分支只专注 Windows 的“按住说话”热键稳定性。

      // Windows: 锁屏/休眠后全局 hook 可能丢失；解锁/唤醒时做一次兜底恢复
      if (process.platform === 'win32') {
        let lastHotkeyRestartAt = 0;
        let unlockRestartAttempts = 0;
        let unlockRestartTimeout: NodeJS.Timeout | null = null;
        let lastHealthCheckRestartAt = 0;

        const shouldAvoidReRegisterNow = (): boolean => {
          try {
            const s = getHoldRecorderStatus();
            // If we just started a hold-to-record session (native emitted start), don't stop/start the hook.
            if (s?.lastEventType === 'start' && typeof s?.lastEventAt === 'number') {
              if (Date.now() - s.lastEventAt < 5000) return true;
            }
          } catch {
            // ignore
          }
          return false;
        };

        const isHotkeyHealthy = (): boolean => {
          try {
            const s = getHoldRecorderStatus();
            return s.backend === 'native' && s.nativeIsRunning === true;
          } catch {
            return false;
          }
        };

        const restartHotkey = (reason: string, bypassCooldown = false) => {
          try {
            // If hook is already running, skip.
            if (isHotkeyHealthy()) {
              unlockRestartAttempts = 0;
              if (unlockRestartTimeout) {
                clearTimeout(unlockRestartTimeout);
                unlockRestartTimeout = null;
              }
              return;
            }
            // If user is currently holding the key (or just started), don't re-register now.
            if (shouldAvoidReRegisterNow()) return;

            const now = Date.now();
            if (!bypassCooldown) {
              if (now - lastHotkeyRestartAt < 1500) return;
            } else {
              if (now - lastHotkeyRestartAt < 800) return;
            }
            lastHotkeyRestartAt = now;

            console.info(`[main] power event: ${reason}, re-registering hotkey...`);
            // 解锁/唤醒时强制重置状态，避免被“录音进行中”阻止
            voiceSessionActive = false;
            pendingHotkeyReRegister = false;
            queuedHotkeyReRegisterReason = null;
            this.reRegisterGlobalHotkey?.(reason);
          } catch (e) {
            console.warn('[main] Failed to re-register hotkey on power event (win32):', e);
          }
        };

        const delayedRestart = (reason: string) => {
          // If already healthy, do nothing.
          if (isHotkeyHealthy()) return;
          unlockRestartAttempts = 1;
          if (unlockRestartTimeout) {
            clearTimeout(unlockRestartTimeout);
            unlockRestartTimeout = null;
          }
          restartHotkey(reason, true);

          // 优化：减少重试次数，从4次减少到2次，减少总延迟从5秒到2秒
          unlockRestartTimeout = setTimeout(() => {
            if (unlockRestartAttempts > 0) {
              unlockRestartAttempts = 2;
              restartHotkey(`${reason}-retry-2`, true);
              unlockRestartAttempts = 0; // 最后一次重试后立即结束
            }
          }, 1000); // 从1500ms减少到1000ms
        };

        try {
          powerMonitor.on('suspend', () => {
            try {
              console.info('[main] power event: suspend, disposing hotkey hook...');
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
              queuedHotkeyReRegisterReason = null;
              this.disposeGlobalHotkey?.();
            } catch (e) {
              console.warn('[main] Failed to dispose hotkey on suspend (win32):', e);
            }
          });
          powerMonitor.on('lock-screen', () => {
            try {
              console.info('[main] power event: lock-screen, disposing hotkey hook...');
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
              queuedHotkeyReRegisterReason = null;
              unlockRestartAttempts = 0;
              if (unlockRestartTimeout) {
                clearTimeout(unlockRestartTimeout);
                unlockRestartTimeout = null;
              }
              this.disposeGlobalHotkey?.();
            } catch (e) {
              console.warn('[main] Failed to dispose hotkey on lock-screen (win32):', e);
            }
          });
          powerMonitor.on('resume', () => {
            delayedRestart('resume');
          });
          powerMonitor.on('unlock-screen', () => {
            delayedRestart('unlock-screen');
          });
          powerMonitor.on('user-did-become-active', () => {
            delayedRestart('user-did-become-active');
          });
        } catch (err) {
          console.warn('[main] Failed to attach powerMonitor listeners (win32):', err);
        }

        // 兜底健康检查：部分机器 powerMonitor 事件并不可靠，且 hook 可能"静默失效"。
        // 优化：检查频率从5秒改为10秒，减少系统调用开销
        setInterval(() => {
          try {
            if (shouldAvoidReRegisterNow()) return;
            const s = getHoldRecorderStatus();
            if (s.backend !== 'native') return;
            if (s.nativeIsRunning !== false) return;
            const now = Date.now();
            if (now - lastHealthCheckRestartAt < 20_000) return; // 从15秒增加到20秒
            lastHealthCheckRestartAt = now;
            voiceSessionActive = false;
            pendingHotkeyReRegister = false;
            queuedHotkeyReRegisterReason = null;
            console.warn(
              '[main] win32 hotkey healthcheck: nativeIsRunning=false, re-registering...',
            );
            this.reRegisterGlobalHotkey?.('win32-healthcheck-nativeIsRunning-false');
          } catch {
            // ignore
          }
        }, 10000); // 从5000ms改为10000ms
      }

      // 渲染进程请求：把文本粘贴到"当前正在输入"的外部应用
      ipcMain.handle('paste-text', async (_event, text: string) => {
        if (typeof text !== 'string' || !text) return;
        await pasteTextToActiveApp(text);
      });

      // 渲染进程请求：把文本“注入”到当前前台应用（更适合逐 token）
      // 仅使用 native keyhook 发送。
      let injectQueue: Promise<void> = Promise.resolve();
      ipcMain.handle('inject-text', async (_event, text: string) => {
        const t = String(text ?? '');
        if (!t) return;

        const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

        // 串行化注入，避免多次 invoke 并发导致输入框状态/光标错乱（尤其在 IME/富文本控件里更明显）。
        // 重要：队列中任意一次失败都不能“毒化”后续任务，所以每次入队前先 swallow 旧的 rejection。
        injectQueue = injectQueue
          .catch(() => undefined)
          .then(async () => {
            const keyhook = loadKeyhookOrThrow<{
              sendText?: (v: string) => boolean;
              sendTextWmChar?: (v: string) => boolean;
              forceReset?: () => boolean;
              sendShiftEnter?: () => boolean;
              getForegroundProcessName?: () => string;
              getForegroundProcessPath?: () => string;
              getForegroundWindowClassName?: () => string;
            }>();
            if (typeof keyhook.sendText !== 'function') {
              throw new Error('native keyhook.sendText() is not available');
            }

            // 关键处理：在注入前强制释放修饰键/清理钩子残留状态，降低 AltGr/右Alt 等导致的异常输入。
            //
            // 重要优化（修复微信/钉钉丢字）：
            // forceReset() 内部会通过 SendInput 发送 11 个修饰键 key-up 事件（Alt/Ctrl/Shift/Win），
            // 这些事件会经过系统 IME 处理。很多中文输入法用 Shift 切换中英文、Alt 激活菜单等，
            // 如果逐 token 注入时每次都发送这些 key-up，会导致 IME 状态反复切换，
            // 在微信/钉钉等基于 Chromium 的富文本输入框中造成丢字（尤其标点附近）。
            //
            // 解决方案：每轮录音结束后只执行一次 forceReset（第一次 inject-text 时），
            // 后续同一轮的 token 注入不再重复调用。
            if (!voiceSessionActive && injectNeedsForceReset) {
              injectNeedsForceReset = false;
              // NOTE(win): forceReset 会发送 Alt/Ctrl/Shift/Win 的 key-up。
              // 在记事本/Notepad++ 这类 txt 编辑器里，裸 Alt key-up 可能激活菜单焦点，
              // 导致用户感觉“Alt 键被影响”。这些场景下跳过 forceReset，避免干扰。
              let shouldSkipForceReset = false;
              try {
                const proc = String(keyhook.getForegroundProcessName?.() || '').toLowerCase();
                const fullPath = String(keyhook.getForegroundProcessPath?.() || '').toLowerCase();
                const winClass = String(keyhook.getForegroundWindowClassName?.() || '');
                shouldSkipForceReset =
                  proc === 'notepad.exe' ||
                  proc === 'notepad++.exe' ||
                  proc.includes('notepad') ||
                  /[/\\]notepad(\+\+)?[/\\]/i.test(fullPath) ||
                  winClass === 'Notepad' ||
                  winClass.includes('Notepad++');
              } catch {
                // ignore detection error
              }
              try {
                if (!shouldSkipForceReset) {
                  keyhook.forceReset?.();
                }
              } catch {
                // ignore
              }
              await sleep(6);
            }

            // ─── 聊天应用特殊处理（微信/钉钉/企业微信/飞书）───
            // 现象：这些应用（部分基于 CEF，部分是原生 C++ 自绘控件）在接收 SendInput(KEYEVENTF_UNICODE) 时，
            // 会出现“标点符号后吞字”或“标点重复”的问题。
            // 原因：这是因为它们的消息循环在处理 VK_PACKET (虚拟键码) 与 WM_CHAR 的转换时存在时序或双重响应缺陷。
            // 修复：使用 PostMessage(WM_CHAR) 直接发送字符消息，绕过键盘事件翻译层。
            //
            // 若 native 模块未更新（无 sendTextWmChar），使用逐字符 sendText + 延迟。
            const canDetectProc = typeof keyhook.getForegroundProcessName === 'function';
            if (canDetectProc) {
              const proc = String(keyhook.getForegroundProcessName?.() || '').toLowerCase();

              // ── 层次 1：进程名匹配 ──
              const procIsWeChat =
                proc === 'wechat.exe' ||
                proc === 'weixin.exe' ||
                proc.includes('wechat') ||
                proc.includes('weixin');
              const procIsDingTalk = proc === 'dingtalk.exe' || proc.includes('dingtalk');
              const procIsWeCom =
                proc === 'wxwork.exe' || proc.includes('wxwork') || proc.includes('wecom');
              const procIsFeishu =
                proc === 'feishu.exe' ||
                proc === 'lark.exe' ||
                proc.includes('feishu') ||
                proc.includes('lark');
              const procIsQQ =
                proc === 'qq.exe' ||
                proc === 'tim.exe' ||
                proc.includes('qq') ||
                proc.includes('tim');

              // ── 层次 2：完整路径匹配（进程名为空或子进程名不含关键字时的补充）──
              let pathIsWeChat = false;
              let pathIsDingTalk = false;
              let pathIsWeCom = false;
              let pathIsFeishu = false;
              let fullPath = '';
              if (typeof keyhook.getForegroundProcessPath === 'function') {
                fullPath = String(keyhook.getForegroundProcessPath?.() || '').toLowerCase();
                if (!procIsWeChat && fullPath) {
                  pathIsWeChat =
                    /[/\\]wechat[/\\]/i.test(fullPath) ||
                    /[/\\]weixin[/\\]/i.test(fullPath) ||
                    /[/\\]tencent[/\\](wechat|weixin)/i.test(fullPath);
                }
                if (!procIsDingTalk && fullPath) {
                  pathIsDingTalk = /[/\\]dingtalk[/\\]/i.test(fullPath);
                }
                if (!procIsWeCom && fullPath) {
                  pathIsWeCom =
                    /[/\\]wxwork[/\\]/i.test(fullPath) || /[/\\]wecom[/\\]/i.test(fullPath);
                }
                if (!procIsFeishu && fullPath) {
                  pathIsFeishu =
                    /[/\\]feishu[/\\]/i.test(fullPath) || /[/\\]lark[/\\]/i.test(fullPath);
                }
              }

              // ── 层次 3：窗口类名匹配（最可靠——微信有专属窗口类，不受版本/架构影响）──
              let classIsWeChat = false;
              let classIsDingTalk = false;
              let classIsWeCom = false;
              let winClass = '';
              if (typeof keyhook.getForegroundWindowClassName === 'function') {
                winClass = String(keyhook.getForegroundWindowClassName?.() || '');
                // 微信已知窗口类（PC 版各历史版本 / 国内新架构版本）
                classIsWeChat =
                  winClass === 'WeChatMainWndForPC' ||
                  winClass === 'ChatWnd' ||
                  winClass === 'WeChatLoginWndForPC' ||
                  winClass.includes('WeChat') ||
                  winClass.includes('Weixin');
                classIsDingTalk = winClass.includes('DingTalk');
                classIsWeCom = winClass === 'WeWorkWindow' || winClass.includes('WXWork');
              }

              // ── 综合判定（任一维度命中即视为对应聊天应用）──
              const isWeChatLike = procIsWeChat || pathIsWeChat || classIsWeChat;
              const isDingTalkLike = procIsDingTalk || pathIsDingTalk || classIsDingTalk;
              const isWeComLike = procIsWeCom || pathIsWeCom || classIsWeCom;
              const isFeishuLike = procIsFeishu || pathIsFeishu;
              const isQQLike = procIsQQ;
              const isChromeBasedChat =
                isWeChatLike || isDingTalkLike || isWeComLike || isFeishuLike || isQQLike;

              // [Diagnostic] 增强日志：打印三种检测维度，方便排查未匹配情况
              if (isChromeBasedChat) {
                console.info('[inject-text] 识别为聊天应用，使用特殊注入路径。', {
                  proc,
                  path: fullPath.slice(-80),
                  winClass,
                  isWeChatLike,
                  isDingTalkLike,
                  isWeComLike,
                  isFeishuLike,
                  isQQLike,
                });
              } else if (
                proc.includes('wechat') ||
                proc.includes('weixin') ||
                proc.includes('wx') ||
                fullPath.includes('wechat') ||
                fullPath.includes('weixin') ||
                winClass.includes('WeChat') ||
                winClass.includes('Weixin')
              ) {
                console.warn('[inject-text] ⚠️ 疑似微信但未匹配白名单，可能导致吞字。', {
                  proc,
                  path: fullPath.slice(-80),
                  winClass,
                });
              }

              if (isChromeBasedChat) {
                // 优先使用 WM_CHAR 方式（彻底修复标点替代字符 bug）
                const useWmChar = typeof keyhook.sendTextWmChar === 'function';
                const sendCharFn = useWmChar ? keyhook.sendTextWmChar! : keyhook.sendText!;
                // 用 [...t] 按 Unicode 码点拆分（正确处理 emoji 等代理对），
                // 避免把 surrogate pair 拆成两个无效的 UTF-16 code unit。
                const codePoints = [...t];
                let charOk = true;
                for (let ci = 0; ci < codePoints.length; ci++) {
                  const ch = codePoints[ci];
                  // 换行在聊天应用中用 Shift+Enter，避免 Enter 直接发送消息
                  if (ch === '\r') continue;
                  if (ch === '\n') {
                    if (typeof keyhook.sendShiftEnter === 'function') {
                      const okNl = keyhook.sendShiftEnter();
                      if (!okNl) {
                        charOk = false;
                        break;
                      }
                    } else {
                      // 缺少换行能力时不要静默吞掉换行，直接视为失败
                      charOk = false;
                      break;
                    }
                    continue;
                  }
                  charOk = sendCharFn(ch);
                  if (!charOk) break;
                  // WM_CHAR 方式不存在 VK_PACKET 干扰，短延迟即可；
                  // sendText 路径下对标点使用更长延迟，减少丢字。
                  if (useWmChar) {
                    await sleep(5);
                  } else {
                    const CJK_PUNCT = /[\u3000-\u303F\uFF00-\uFFEF\u2000-\u206F\u00B7]/;
                    if (CJK_PUNCT.test(ch)) {
                      await sleep(45);
                    } else {
                      await sleep(5);
                    }
                  }
                }
                if (charOk) return;
                throw new Error('native per-char injection failed for chat app');
              }
            }

            // 非聊天应用：企业微信换行特殊处理（Shift+Enter）
            // 注意：企业微信已在上方聊天应用分支统一处理，此分支仅作为
            // getForegroundProcessName 不可用时，按同样三重检测处理企业微信换行。
            const hasWeComHelpers =
              typeof keyhook.sendShiftEnter === 'function' &&
              typeof keyhook.getForegroundProcessName === 'function';
            if (hasWeComHelpers && /[\r\n]/.test(t)) {
              const proc2 = String(keyhook.getForegroundProcessName?.() || '').toLowerCase();
              const fullPath2 =
                typeof keyhook.getForegroundProcessPath === 'function'
                  ? String(keyhook.getForegroundProcessPath?.() || '').toLowerCase()
                  : '';
              const winClass2 =
                typeof keyhook.getForegroundWindowClassName === 'function'
                  ? String(keyhook.getForegroundWindowClassName?.() || '')
                  : '';
              const isWeCom =
                proc2 === 'wxwork.exe' ||
                proc2.includes('wxwork') ||
                proc2.includes('wecom') ||
                /[/\\]wxwork[/\\]/i.test(fullPath2) ||
                /[/\\]wecom[/\\]/i.test(fullPath2) ||
                winClass2 === 'WeWorkWindow' ||
                winClass2.includes('WXWork');
              if (isWeCom) {
                const parts = t.split(/\r\n|\n|\r/);
                for (let i = 0; i < parts.length; i++) {
                  const p = parts[i] ?? '';
                  if (p) {
                    const ok = keyhook.sendText(p);
                    if (!ok) throw new Error('sendText failed');
                  }
                  if (i < parts.length - 1) {
                    const okNl = keyhook.sendShiftEnter?.();
                    if (!okNl) throw new Error('sendShiftEnter failed');
                  }
                }
                return;
              }
            }

            const ok = keyhook.sendText(t);
            if (ok) {
              // 流式输入场景：给予目标应用微小喘息时间，避免连续 invoke 导致输入丢失
              await sleep(15);
              return;
            }
            throw new Error('native keyhook.sendText() failed');
          });

        return injectQueue;
      });

      // 渲染进程请求：从"当前前台应用"读取选中文本（跨应用）
      ipcMain.handle('get-selected-text', async () => {
        return await readSelectedTextFromActiveApp();
      });
      // 渲染进程请求：读取/更新“按住录音”热键配置（mac/win 分开，立即生效）
      ipcMain.handle('settings-get-hold-to-record', async () => {
        return getHoldToRecordConfig();
      });
      ipcMain.handle('settings-set-hold-to-record', async (_event, patch: any) => {
        const merged = { ...getHoldToRecordConfig(), ...(patch || {}) };
        const holdValidation = validateHoldKey('win', merged.winKey);
        if (holdValidation.blockedReasons.length > 0) {
          return {
            success: false,
            config: getHoldToRecordConfig(),
            blockedReasons: holdValidation.blockedReasons,
            warningReasons: holdValidation.warningReasons,
          };
        }
        const next = setHoldToRecordConfig(patch || {});
        console.info('[main] updated hold-to-record config:', next);
        try {
          this.reRegisterGlobalHotkey?.('settings-set-hold-to-record');
        } catch (error) {
          console.warn('[main] Failed to re-register hotkey after settings update:', error);
        }
        return {
          success: true,
          config: next,
          blockedReasons: [] as string[],
          warningReasons: holdValidation.warningReasons,
        };
      });
      ipcMain.handle('settings-get-toggle-to-record', async () => {
        return getToggleToRecordConfig();
      });
      ipcMain.handle('settings-validate-toggle-to-record', async (_event, payload: unknown) => {
        const raw = normalizeToggleToRecordConfig(payload);
        const v = validateToggleAccelerator('win', raw.winAccelerator);
        return {
          config: raw,
          blockedReasons: v.blockedReasons,
          warningReasons: v.warningReasons,
        };
      });
      ipcMain.handle('settings-set-toggle-to-record', async (_event, payload: unknown) => {
        const cur = getToggleToRecordConfig();
        const nextRaw = normalizeToggleToRecordConfig({ ...cur, ...(payload || {}) });
        const v = validateToggleAccelerator('win', nextRaw.winAccelerator);
        if (v.blockedReasons.length > 0) {
          return {
            success: false,
            config: cur,
            blockedReasons: v.blockedReasons,
            warningReasons: v.warningReasons,
          };
        }
        const next = setToggleToRecordConfig(nextRaw);
        console.info('[main] updated toggle-to-record config:', next);
        try {
          this.reRegisterGlobalHotkey?.('settings-set-toggle-to-record');
        } catch (error) {
          console.warn('[main] Failed to re-register hotkey after toggle settings update:', error);
        }
        return {
          success: true,
          config: next,
          blockedReasons: [] as string[],
          warningReasons: v.warningReasons,
        };
      });

      // 设置页：读取/更新开机自启（mac/win 都支持；开发态仅保存不改系统设置）
      ipcMain.handle('settings-get-auto-launch', async () => {
        return { enabled: getAutoLaunchEnabled() };
      });
      ipcMain.handle('settings-set-auto-launch', async (_event, payload: unknown) => {
        const enabled = (payload as any)?.enabled;
        const next = setAutoLaunchEnabled(enabled);
        console.info('[main] updated auto-launch enabled:', next);
        applyAutoLaunch(next);
        return { enabled: next };
      });

      // 设置页：读取/更新首选麦克风 deviceId（null 表示系统默认麦克风）
      ipcMain.handle('settings-get-preferred-mic', async () => {
        return { deviceId: getPreferredMicDeviceId() };
      });
      ipcMain.handle('settings-set-preferred-mic', async (_event, payload: unknown) => {
        const deviceId = (payload as any)?.deviceId;
        const next = setPreferredMicDeviceId(deviceId);
        console.info('[main] updated preferred mic deviceId:', next);
        return { deviceId: next };
      });

      // 设置页：读取/更新系统提示音开关（影响 shell.beep）
      ipcMain.handle('settings-get-system-sound', async () => {
        return { enabled: getSystemPromptSoundEnabled() };
      });
      ipcMain.handle('settings-set-system-sound', async (_event, payload: unknown) => {
        const enabled = (payload as any)?.enabled;
        const next = setSystemPromptSoundEnabled(enabled);
        console.info('[main] updated system prompt sound enabled:', next);
        return { enabled: next };
      });

      // 设置页：读取/更新自动翻译目标语言
      ipcMain.handle('settings-get-preferred-language-variant', async () => {
        return { value: getPreferredLanguageVariant() };
      });
      ipcMain.handle(
        'settings-set-preferred-language-variant',
        async (_event, payload: unknown) => {
          const value = (payload as any)?.value;
          const next = setPreferredLanguageVariant(value);
          console.info('[main] updated preferred language variant:', next);
          return { value: next };
        },
      );

      // 设置页/诊断：获取热键状态
      ipcMain.handle('hotkey-get-status', async () => {
        const status = getHoldRecorderStatus();
        // Win：若渲染进程偶发漏发 recording-stopped，但原生热键事件已到 stop/cancel，
        // 则在设置页轮询状态时主动解锁，避免会话状态长期卡死。
        if (voiceSessionActive) {
          const lastEventType = status.lastEventType;
          const lastEventAt = typeof status.lastEventAt === 'number' ? status.lastEventAt : 0;
          const shouldRecoverStaleSession =
            (lastEventType === 'stop' || lastEventType === 'cancel' || lastEventType === 'keyup') &&
            lastEventAt > 0 &&
            lastEventAt >= (voiceSessionActiveSince || 0);
          if (shouldRecoverStaleSession) {
            voiceSessionActive = false;
            voiceSessionActiveSince = 0;
            comboRecordingActive = false;
          }
        }
        return {
          config: getHoldToRecordConfig(),
          toggleConfig: getToggleToRecordConfig(),
          status,
          voiceSessionActive,
        };
      });

      // 设置页/诊断：强制重新注册热键（用于自愈）
      ipcMain.handle('hotkey-reregister', async () => {
        try {
          this.reRegisterGlobalHotkey?.('manual-from-settings');
          return { success: true };
        } catch (e: any) {
          return { success: false, error: e?.message || String(e) };
        }
      });

      // 渲染进程：显示/关闭系统级重写结果悬浮窗
      ipcMain.on(
        'rewrite-overlay-show',
        (_event, payload: { text?: string; questionText?: string }) => {
          console.log(1231231222222223);
          return;
          try {
            showRewriteOverlay(payload?.text || '', {
              questionText: payload?.questionText || '',
            });
          } catch (e) {
            console.warn('[main] rewrite-overlay-show failed:', e);
          }
        },
      );
      // 渲染进程：显示重写结果悬浮窗（可等待/可回传错误）
      ipcMain.handle(
        'rewrite-overlay-show',
        async (_event, payload: { text?: string; questionText?: string }) => {
          try {
            await showRewriteOverlayAndWait(payload?.text || '', {
              questionText: payload?.questionText || '',
            });
            return { success: true };
          } catch (e: any) {
            return { success: false, error: e?.message || String(e) };
          }
        },
      );
      ipcMain.on('rewrite-overlay-hide', () => {
        hideRewriteOverlay();
        // 关闭时兜底恢复“鼠标穿透”状态，避免悬浮窗在下一次显示前处于可交互态
        try {
          setRewriteOverlayEditable(false);
          setRewriteOverlayHovered(false);
        } catch {
          //
        }
      });
      ipcMain.on('rewrite-overlay-mouse', (_event, payload: { hovered?: boolean }) => {
        setRewriteOverlayHovered(!!payload?.hovered);
      });
      ipcMain.on('rewrite-overlay-edit', (_event, payload: { editing?: boolean }) => {
        setRewriteOverlayEditable(!!payload?.editing);
      });
      // 重写结果：用户在悬浮窗中编辑后“复制并关闭”才记录埋点（由渲染进程接收并上报）
      ipcMain.on(
        'rewrite-overlay-ai-edit',
        (
          event,
          payload: {
            original?: string;
            edited?: string;
          },
        ) => {
          try {
            const original = typeof payload?.original === 'string' ? payload.original : '';
            const edited = typeof payload?.edited === 'string' ? payload.edited : '';
            if (!original || !edited || original === edited) return;
            for (const w of BrowserWindow.getAllWindows()) {
              if (!w || w.isDestroyed()) continue;
              if (w.webContents === event.sender) continue; // skip overlay itself
              try {
                w.webContents.send('posthog-track', {
                  event: 'sensetype_ai_result_edit',
                  properties: { $x_original: original, $x_edited: edited },
                });
              } catch {
                //
              }
            }
          } catch {
            //
          }
        },
      );

      // 语音波动：系统级悬浮窗（由渲染进程推送状态/音量）
      ipcMain.on(
        'voice-indicator-set',
        (
          _event,
          payload: {
            visible?: boolean;
            status?: 'speaking' | 'silent' | 'loading' | 'notice' | 'error';
            volumes?: number[] | null;
            message?: string;
            previewText?: string;
            autoHideMs?: number;
            resetTimer?: boolean;
            nonBlockingHint?: boolean;
          },
        ) => {
          updateVoiceIndicator({
            visible: !!payload?.visible,
            status: payload?.status || 'silent',
            volumes: payload?.volumes || null,
            message: payload?.message,
            previewText: payload?.previewText,
            autoHideMs: payload?.autoHideMs,
            resetTimer: !!payload?.resetTimer,
            nonBlockingHint: !!payload?.nonBlockingHint,
          });
        },
      );

      // 语音波动条：鼠标移入可交互（用于停止/取消）
      ipcMain.on('voice-indicator-hover', (_event, payload: { hovered?: boolean }) => {
        try {
          const hovered = !!payload?.hovered;
          const w = ensureVoiceIndicatorWindow();
          w.setIgnoreMouseEvents(!hovered, { forward: true });
        } catch {
          //
        }
      });
      // 语音波动条：toast 文案过长时自适应宽度
      ipcMain.on(
        'voice-indicator-resize',
        (_event, payload: { width?: number; height?: number }) => {
          try {
            resizeVoiceIndicatorWindow({
              width: typeof payload?.width === 'number' ? payload.width : undefined,
              height: typeof payload?.height === 'number' ? payload.height : undefined,
            });
          } catch {
            //
          }
        },
      );
      ipcMain.on('voice-indicator-action', (event, payload: { action?: string }) => {
        const action = String(payload?.action || '');
        if (action !== 'cancel' && action !== 'stop') return;
        comboRecordingActive = false;
        try {
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w || w.isDestroyed()) continue;
            if (w.webContents === event.sender) continue;
            try {
              w.webContents.send('global-record', { action: 'cancel' });
            } catch {
              //
            }
          }
        } catch {
          //
        }
      });

      // 渲染进程回传：真实录音/识别状态，用于提示用户（窗口收起/不在前台也能看到）
      ipcMain.on(
        'voice-feedback',
        (_event, payload: { type?: string; message?: string; detail?: any }) => {
          const type = payload?.type;
          lastVoiceFeedbackAt = Date.now();
          try {
            const holdKeyName = describeHoldKeyForPlatform();
            if (type === 'recording-started') {
              voiceSessionActive = true;
              voiceSessionActiveSince = voiceSessionActiveSince || Date.now();
              // 新的录音会话开始：标记下次 inject-text 需要做一次 forceReset
              injectNeedsForceReset = true;
              if (getSystemPromptSoundEnabled()) shell.beep();
              // 预热重写悬浮窗：录音开始时提前加载 HTML，避免重写结果出来时首次创建窗口导致超时
              preloadRewriteOverlay();
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip(
                  `SenseAudio AI语音输入法：录音中…（松开 ${holdKeyName} 停止）`,
                );
              }
              // NOTE(win): 不弹系统通知，避免“每次按住热键就提示”的干扰。
            } else if (type === 'recording-stopped') {
              voiceSessionActive = false;
              voiceSessionActiveSince = 0;
              comboRecordingActive = false;
              // 录音停止：确保下一次 inject-text 做一次 forceReset（释放可能残留的修饰键）
              injectNeedsForceReset = true;
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip('SenseAudio AI语音输入法：录音结束，正在识别…');
              }
              // NOTE(win): 不弹系统通知，避免干扰。
            } else if (type === 'recognition-done') {
              // 兜底：即使某次未收到 recording-stopped，也不要一直锁住重注册
              voiceSessionActive = false;
              voiceSessionActiveSince = 0;
              comboRecordingActive = false;
              // Win: 成功后强制收起波动条，避免渲染侧状态未及时回落导致不消失
              try {
                updateVoiceIndicator({ visible: false, status: 'silent', volumes: null });
              } catch {
                //
              }
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip('SenseAudio AI语音输入法：识别完成（已自动写入/粘贴）');
              }
              // NOTE(win): 不弹系统通知，避免干扰。
            } else if (type === 'recognition-error') {
              voiceSessionActive = false;
              voiceSessionActiveSince = 0;
              comboRecordingActive = false;
              // Win: 失败时也收起 loading 波动条（错误 toast 由渲染侧负责）
              try {
                updateVoiceIndicator({ visible: false, status: 'silent', volumes: null });
              } catch {
                //
              }
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip('SenseAudio AI语音输入法：识别失败（点击查看）');
              }
              // NOTE(win): 不弹系统通知，避免干扰。
            }
          } catch {
            //
          }

          // 若之前因为录音进行中而延迟了热键重注册，这里在录音结束后补一次。
          if (!voiceSessionActive && pendingHotkeyReRegister) {
            const nextReason = queuedHotkeyReRegisterReason || 'pending-after-voice';
            pendingHotkeyReRegister = false;
            queuedHotkeyReRegisterReason = null;
            try {
              console.info('[main] voice session ended, applying pending hotkey re-register...');
              void registerHotkey(`pending:${nextReason}`);
            } catch (e) {
              console.warn('[main] Failed to apply pending hotkey re-register:', e);
            }
          }
        },
      );
    });
  }

  onRunning() {
    // Windows 下无需额外 onRunning 逻辑
  }

  onQuit() {
    app.on('window-all-closed', () => {
      app.quit();
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
      this.disposeGlobalHotkey?.();
      // 清理 Tray，避免销毁后事件监听器仍然触发
      if (this.tray && !this.tray.isDestroyed()) {
        this.tray.removeAllListeners();
        this.tray.destroy();
        this.tray = undefined;
      }
    });

    app.on('before-quit', () => {
      // 提前清理 Tray，避免退出时触发事件
      if (this.tray && !this.tray.isDestroyed()) {
        this.tray.removeAllListeners();
        this.tray.destroy();
        this.tray = undefined;
      }
    });
  }
}

export default new ElectronMain();
