'use strict';
import './bootstrapPackaged';
import {
  app,
  globalShortcut,
  protocol,
  BrowserWindow,
  ipcMain,
  Tray,
  Notification,
  shell,
  systemPreferences,
  session,
  desktopCapturer,
  powerMonitor,
  dialog,
} from 'electron';
import path from 'path';
import main from '../browsers/main.mac';
import createTray from '../browsers/trayConfig';
import {
  getHoldRecorderStatus,
  registerGlobalHoldRecorder,
  suppressHoldRecorderStart,
} from './globalRecorderHotkey';
import { pasteTextToActiveApp } from './pasteToActiveApp';
import { readSelectedTextFromActiveApp } from './copyFromActiveApp';
import { tryLoadKeyhook } from './keyhookLoader';
import {
  getAccessibilityPromptState,
  getHoldToRecordConfig,
  getToggleToRecordConfig,
  getAutoLaunchEnabled,
  getPreferredLanguageVariant,
  getPreferredMicDeviceId,
  getSystemPromptSoundEnabled,
  setAccessibilityPromptState,
  setAutoLaunchEnabled,
  setPreferredLanguageVariant,
  setPreferredMicDeviceId,
  setHoldToRecordConfig,
  setToggleToRecordConfig,
  setSystemPromptSoundEnabled,
} from '../common/settingsStore';
import {
  normalizeToggleToRecordConfig,
  validateHoldKey,
  validateToggleAccelerator,
} from '../../common/hotkeyRules';

function describeHoldKeyForPlatform(cfg: { macKey: string }): string {
  if (cfg.macKey === 'option') return 'Option/Alt';
  if (cfg.macKey === 'control') return 'Control';
  if (cfg.macKey === 'shift') return 'Shift';
  if (cfg.macKey === 'command') return 'Command';
  return 'Option/Alt';
}
import {
  hideRewriteOverlay,
  isRewriteOverlayVisible,
  setRewriteOverlayEditable,
  setRewriteOverlayHovered,
  setRewriteOverlaySuspended,
  showRewriteOverlay,
  showRewriteOverlayAndWait,
} from './rewriteOverlayWindow';
import {
  ensureVoiceIndicatorWindow,
  setVoiceIndicatorSuspended,
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

function macSystemNotificationsEnabled(): boolean {
  // 用户诉求：macOS 不需要任何系统通知（按键/快捷键/权限/识别提示等）。
  // 如需临时排障，可设置环境变量开启：SENSETYPE_MAC_NOTIFICATIONS=1
  const v = String(process.env.SENSETYPE_MAC_NOTIFICATIONS || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

function tryShowMacNotification(p: { title: string; body: string; onClick?: () => void }) {
  if (!macSystemNotificationsEnabled()) return;
  try {
    if (!Notification.isSupported()) return;
    const n = new Notification({ title: p.title, body: p.body });
    if (typeof p.onClick === 'function') {
      n.on('click', () => {
        try {
          p.onClick?.();
        } catch {
          //
        }
      });
    }
    n.show();
  } catch {
    //
  }
}
class ElectronMain {
  public windowCreator!: {
    init: () => void;
    getWindow: () => BrowserWindow | undefined;
    getOrCreateWindow?: () => BrowserWindow;
    getLoginWindow?: () => BrowserWindow | null;
    setTrayVisibilityCallback?: (callback: (visible: boolean) => void) => void;
    setRecordingState?: (recording: boolean) => void;
  };
  private systemPlugins: unknown;
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

      // hash fallback: senseType-client://login#token=...
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

      // hash fallback: sensetype-client://xxx#launch=2
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
    try {
      // 兜底：网页唤起后确保 Dock 图标可见，避免激活链路异常导致图标短暂消失。
      // 仅在图标真正不可见时才调用，避免 dock.show() 导致窗口闪烁/重新激活。
      if (app.dock && typeof app.dock.isVisible === 'function' && !app.dock.isVisible()) {
        app.dock.show?.();
      }
    } catch {
      // ignore
    }
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

    // 1) 换号：先清理旧登录态，再写入新 token（避免旧 userInfo 残留/串号）
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

    // 2) 同步到渲染进程 localStorage，并切回首页
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

    // 3) 广播登录态变更给所有窗口（zustand 立刻更新）
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

    // macOS: deep link 可能在 ready 前触发，尽早绑定
    app.on('open-url', (event, url) => {
      try {
        event.preventDefault();
      } catch {
        // ignore
      }
      try {
        this.handleDeepLinkUrl(String(url || ''));
      } catch {
        // ignore
      }
    });

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
      // 第二实例启动时（例如点击 deep link），将参数转发给主实例处理
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
      ipcMain.on('msg-trigger', (event, payload: { type?: string; data?: unknown }) => {
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
            const d = data as { body?: unknown } | null;
            const body = typeof d?.body === 'string' ? d.body : String(d?.body || '');
            tryShowMacNotification({ title: 'Sensetype', body });
            event.returnValue = true;
            return;
          }

          event.returnValue = new Error(`[msg-trigger] Unsupported type: ${type}`);
        } catch (e) {
          event.returnValue = e instanceof Error ? e : new Error(String(e));
        }
      });

      // Chromium permission bridge:
      // - On macOS packaged apps, getUserMedia() can be silently denied unless we explicitly allow the request.
      // - We still rely on TCC (systemPreferences.askForMediaAccess) for the real OS-level microphone grant.
      try {
        const ses = session.defaultSession;
        ses.setPermissionRequestHandler((webContents, permission, callback, details: unknown) => {
          try {
            if (permission === 'media') {
              const d = details as { mediaTypes?: unknown } | null;
              const mediaTypes: string[] = Array.isArray(d?.mediaTypes)
                ? (d?.mediaTypes as string[])
                : [];
              const wantsAudio = mediaTypes.length === 0 || mediaTypes.includes('audio');
              if (wantsAudio) return callback(true);
            }
            // Allow Screen Capture API permission checks (actual screen recording permission is handled by macOS TCC).
            if (permission === 'display-capture') return callback(true);
          } catch {
            // ignore
          }
          callback(false);
        });

        // Enable navigator.mediaDevices.getDisplayMedia in Electron renderer.
        // Without this, Chromium may throw "NotSupportedError: Not supported".
        ses.setDisplayMediaRequestHandler(async (request, callback) => {
          try {
            const sources = await desktopCapturer.getSources({ types: ['screen'] });
            const first = sources && sources[0] ? sources[0] : null;
            if (!first) return callback({});
            callback({
              // On macOS, loopback audio via callback is not supported; we still grant video to trigger
              // the system prompt / Screen Recording permission and allow SCStream-based audio capture separately.
              video: first,
            });
          } catch {
            callback({});
          }
        });
      } catch (e) {
        console.warn('[permission] Failed to set permission request handler:', e);
      }

      // macOS: 请求麦克风权限（Intel Mac 需要主动请求）
      registerRequestHandlers();
      registerTokenStoreHandlers();
      registerRecordingsHandlers();
      registerAvatarHandlers();
      setupStickyNoteIpc();
      // 先注册 IPC（尤其是 token-store-* 的 sendSync），再创建窗口，避免渲染进程启动早于 handler 导致读不到 token/userInfo
      this.createWindow();
      // 若 deep link 在窗口创建前触发（open-url/argv），这里补发一次 pending 的 refresh 请求
      this.flushPendingUserRefreshRequest();

      // 首次启动若 argv 带了 deep link，ready 后补处理一次
      try {
        this.pendingDeepLinkUrl = this.extractDeepLinkFromArgv(process.argv || []);
        if (this.pendingDeepLinkUrl) this.handleDeepLinkUrl(this.pendingDeepLinkUrl);
      } catch {
        // ignore
      }

      // Intel(macOS x64) 全屏退出问题：
      // - 系统级 overlay（alwaysOnTop: 'screen-saver' + visibleOnFullScreen）可能会遮挡/抢占交互，导致系统的“退出全屏”不可用
      // - 进入全屏时强制禁用 overlay；退出全屏后恢复
      try {
        const attachFullscreenGuards = () => {
          const w = this.windowCreator?.getWindow?.();
          if (!w || w.isDestroyed()) return;
          const anyW = w as unknown as { __sensetypeFullscreenGuardsAttached?: boolean };
          if (anyW.__sensetypeFullscreenGuardsAttached) return;
          anyW.__sensetypeFullscreenGuardsAttached = true;

          const hideOverlays = () => {
            try {
              hideRewriteOverlay();
            } catch {
              /* ignore */
            }
            try {
              updateVoiceIndicator({ visible: false, status: 'silent', volumes: null });
            } catch {
              /* ignore */
            }
          };

          const suspendOverlays = (on: boolean) => {
            try {
              // 仅 Intel(macOS x64) 启用该策略，M 系列保持现状
              if (process.platform === 'darwin' && process.arch === 'x64') {
                setRewriteOverlaySuspended(on);
                setVoiceIndicatorSuspended(on);
              }
            } catch {
              /* ignore */
            }
          };

          // 进入全屏前就把 overlay 收起，避免遮挡系统 UI（绿按钮/菜单栏）
          w.on('enter-full-screen', () => {
            suspendOverlays(true);
            hideOverlays();
          });
          w.on('enter-html-full-screen', () => {
            suspendOverlays(true);
            hideOverlays();
          });

          // 退出全屏后恢复 overlay（由业务链路决定是否显示）
          w.on('leave-full-screen', () => suspendOverlays(false));
          w.on('leave-html-full-screen', () => suspendOverlays(false));

          // 退出全屏时不自动恢复 overlay（由各业务链路自行控制显示）
        };

        // 窗口创建可能略晚于 ready，这里延迟一次挂载
        setTimeout(attachFullscreenGuards, 50);
      } catch {
        /* ignore */
      }
      // 启动时应用一次“开机自启”设置（macOS/Windows 都走 setLoginItemSettings）
      applyAutoLaunch(getAutoLaunchEnabled());

      // macOS: 辅助功能权限弹窗策略（避免拒绝后反复弹/权限切换卡顿）
      // - 后台/自愈链路绝不触发系统弹窗
      // - 仅首次启动尝试一次；以及用户在前台按住录音键时（冷却 5 分钟）
      let accessibilityTrustedCached: boolean | null = null;
      const refreshAccessibilityTrusted = () => {
        if (process.platform !== 'darwin') {
          accessibilityTrustedCached = true;
          return true;
        }
        try {
          const trusted = systemPreferences.isTrustedAccessibilityClient(false);
          accessibilityTrustedCached = trusted;
          return trusted;
        } catch {
          accessibilityTrustedCached = null;
          return null;
        }
      };
      const ACCESSIBILITY_SETTINGS_URL =
        'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility';
      const focusWindowForSystemPrompt = () => {
        try {
          // 关键：在触发系统级权限弹窗前，先把我们自己的“顶层悬浮窗”收起来。
          // 否则 `alwaysOnTop: 'screen-saver'` 可能把系统弹窗压在后面，表现为“弹窗没出现/不在最前”。
          try {
            hideRewriteOverlay();
          } catch {
            /* ignore */
          }
          try {
            // 语音指示条是永久 topmost，权限弹窗期间最好先隐藏，避免挡住系统弹窗
            updateVoiceIndicator({ visible: false, status: 'silent', volumes: null });
          } catch {
            /* ignore */
          }

          const win =
            this.windowCreator?.getWindow?.() || this.windowCreator?.getLoginWindow?.() || null;
          if (win && !win.isDestroyed()) {
            try {
              try {
                if (typeof win.isMinimized === 'function' && win.isMinimized()) win.restore();
              } catch {
                /* ignore */
              }
              win.show();
              win.focus();
            } catch {
              /* ignore */
            }
            try {
              // 以前这里会 setAlwaysOnTop('screen-saver')，但会和系统授权弹窗争抢 z-order，
              // 导致系统弹窗被压在后面。这里只做常规前置即可。
              win.moveTop?.();
            } catch {
              /* ignore */
            }
          } else {
            try {
              // 尽量把应用拉到前台（不使用 any/非标准参数，避免 TS/lint 报警）
              app.focus();
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      };
      const openAccessibilitySettings = async (): Promise<boolean> => {
        try {
          // openExternal 在不同 Electron 版本可能返回 Promise<void> / Promise<boolean> / boolean
          const ret = shell.openExternal(ACCESSIBILITY_SETTINGS_URL) as
            | boolean
            | Promise<boolean>
            | Promise<void>;
          const v = await Promise.resolve(ret);
          // 如果没有返回值，视为“已发起打开”
          return typeof v === 'boolean' ? v : true;
        } catch {
          return false;
        }
      };
      const promptAccessibility = async (
        mode: 'startup' | 'user-hotkey',
        options?: { force?: boolean },
      ) => {
        if (process.platform !== 'darwin') return;
        if (accessibilityTrustedCached === true) return;
        const now = Date.now();
        const st = getAccessibilityPromptState();
        if (mode === 'startup') {
          // 关键修复：不要在“真正触发系统弹窗/打开系统设置”之前就写入 firstPromptedAt，
          // 否则首次启动处于后台/锁屏等场景时，openExternal/prompt 可能失败，但状态会被永久抑制。
          if (st.firstPromptedAt) return;
        } else {
          const last = st.lastUserPromptAt || 0;
          if (!options?.force) {
            if (last && now - last < 5 * 60 * 1000) return;
            setAccessibilityPromptState({ lastUserPromptAt: now });
          } else {
            // 用户在“引导页/设置页”主动点击时：允许绕过冷却，但仍更新 lastUserPromptAt，避免连续误触刷屏
            setAccessibilityPromptState({ lastUserPromptAt: now });
          }
        }

        focusWindowForSystemPrompt();
        // Intel(macOS x64)：避免调用 true（历史上会卡死），只引导打开系统设置
        if (process.arch === 'x64') {
          const opened = await openAccessibilitySettings();
          if (opened && mode === 'startup') {
            setAccessibilityPromptState({ firstPromptedAt: now });
          }
          return;
        }

        // Apple Silicon：仅在首次启动/用户主动时触发一次系统弹窗
        try {
          const result = systemPreferences.isTrustedAccessibilityClient(true);
          accessibilityTrustedCached = result;
          // 只有在真正执行了 prompt 之后，才认为“已经尝试提示过”
          if (mode === 'startup') {
            setAccessibilityPromptState({ firstPromptedAt: now });
          }
          // 用户在“引导页/设置页”主动点击时：始终打开系统设置页（即使刚弹过/即使 result=true）
          if (options?.force) {
            void openAccessibilitySettings();
          } else {
            // 兜底：有些环境下系统弹窗不明显/被遮挡，若仍未授权则主动打开系统设置页
            if (result === false) {
              void openAccessibilitySettings();
            }
          }
        } catch (e) {
          console.warn('[permission] Failed to trigger accessibility prompt:', e);
          // prompt 失败时不要写入 firstPromptedAt，允许下次启动再次尝试
          // 同时做一次“打开系统设置页”的兜底（即使 prompt API 失败，也尽量引导用户完成授权）
          void openAccessibilitySettings();
        }
      };
      refreshAccessibilityTrusted();
      if (process.platform === 'darwin') {
        setTimeout(() => {
          refreshAccessibilityTrusted();
          if (accessibilityTrustedCached === false) void promptAccessibility('startup');
        }, 900);
      }

      // 登录窗口右上角 X：渲染进程会发出 app-quit，这里统一处理为退出应用
      ipcMain.on('app-quit', () => {
        try {
          app.quit();
        } catch {
          // ignore
        }
        // mac：兜底强制退出，避免 quit 被窗口 close 拦截导致进程残留
        if (process.platform === 'darwin') {
          setTimeout(() => {
            try {
              app.exit(0);
            } catch {
              // ignore
            }
          }, 2500);
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
              // 降级方案：重新初始化
              this.windowCreator.init();
              const win = this.windowCreator.getWindow();
              if (!win) {
                throw new Error('无法创建窗口');
              }
              return win;
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
          // 窗口存在且未销毁，直接返回（绝不在热键路径隐藏当前可见窗口）
          return win;
        }
        // 窗口不存在或已销毁：创建后台窗口（createWindow 本身即 show:false）
        console.info('[global-alt-recorder] window not found, creating hidden window...');
        if (this.windowCreator.getOrCreateWindow) {
          win = this.windowCreator.getOrCreateWindow();
          return win;
        }
        // 降级方案：初始化窗口
        this.windowCreator.init();
        win = this.windowCreator.getWindow();
        return win;
      };

      // 注册热键的函数，可以在权限恢复后重新调用
      // 录音状态：用于避免“周期性重注册热键”在长按录音过程中把 hook 停掉，导致松开时无法 stop。
      let voiceSessionActive = false;
      let pendingHotkeyReRegister = false;
      let lastVoiceFeedbackAt = 0;
      let voiceSessionActiveSince = 0;
      let comboRecordingActive = false;
      let hotkeyTemporarilySuspended = false;
      let disposeToggleToRecordShortcut: (() => void) | undefined;
      // 权限撤销时不要丢掉 disposer（避免后续重复启动多个 native hook）；仅“暂停重注册”，等权限恢复后再安全重启
      let hotkeySuppressedByPermission = false;
      // 用户回到电脑/切回前台的时间（用于更精准的自愈触发，避免频繁 stop/start）
      let lastUserActiveAt = Date.now();

      const sendGlobalRecordAction = (
        action: 'start' | 'stop' | 'cancel',
        meta?: { hotkeyMode?: 'single' | 'combo' },
      ) => {
        try {
          const win = this.windowCreator?.getWindow?.() || null;
          if (!win || win.isDestroyed()) return;
          if (win.webContents.isDestroyed()) return;
          if (win.webContents.isLoading()) {
            win.webContents.once('did-finish-load', () => {
              try {
                if (!win.isDestroyed() && !win.webContents.isDestroyed()) {
                  win.webContents.send('global-record', { action, ...(meta || {}) });
                }
              } catch {
                //
              }
            });
            return;
          }
          win.webContents.send('global-record', { action, ...(meta || {}) });
        } catch {
          //
        }
      };

      const clearToggleToRecordShortcut = () => {
        try {
          disposeToggleToRecordShortcut?.();
        } catch {
          //
        }
        disposeToggleToRecordShortcut = undefined;
      };

      const registerToggleToRecordShortcut = (accelerator: string) => {
        if (!accelerator) return;
        const ok = globalShortcut.register(accelerator, () => {
          // 当前在按住录音态下，如果再触发“非长按组合键”，按取消处理，避免状态错乱。
          if (voiceSessionActive && !comboRecordingActive) {
            sendGlobalRecordAction('cancel', { hotkeyMode: 'combo' });
            comboRecordingActive = false;
            return;
          }
          if (comboRecordingActive) {
            sendGlobalRecordAction('stop', { hotkeyMode: 'combo' });
            comboRecordingActive = false;
            return;
          }
          sendGlobalRecordAction('start', { hotkeyMode: 'combo' });
          comboRecordingActive = true;
        });
        if (!ok) {
          console.warn('[main] failed to register toggle hotkey accelerator:', accelerator);
          return;
        }
        disposeToggleToRecordShortcut = () => {
          try {
            globalShortcut.unregister(accelerator);
          } catch {
            //
          }
        };
      };

      const doRegisterHotkey = (reason: string) => {
        if (hotkeyTemporarilySuspended) {
          console.info('[main] skip hotkey register: temporarily suspended', { reason });
          return Promise.resolve();
        }
        // macOS：如果用户在运行中关闭了“辅助功能/Accessibility”，此时 stop/start 原生 keyhook
        // 在部分机器/场景下可能导致主线程卡死。这里在任何 dispose/stop 之前强制刷新权限并早退。
        if (process.platform === 'darwin') {
          try {
            const hasPermissionNow = systemPreferences.isTrustedAccessibilityClient(false);
            accessibilityTrustedCached = hasPermissionNow;
            if (!hasPermissionNow) {
              hotkeySuppressedByPermission = true;
              console.warn(
                '[main] Skip hotkey (re)register because accessibility permission is not granted:',
                { reason },
              );
              return Promise.resolve();
            }
            hotkeySuppressedByPermission = false;
          } catch (e) {
            console.warn(
              '[main] Failed to check accessibility permission before hotkey register:',
              e,
            );
            // 保守：检查失败时不要 stop/start，避免潜在卡死
            return Promise.resolve();
          }
        }

        const cfg = getHoldToRecordConfig();
        const key = cfg.macKey;
        const holdValidation = validateHoldKey('mac', key);
        if (holdValidation.blockedReasons.length > 0) {
          console.warn('[main] skip hold hotkey register due to invalid key:', {
            key,
            reasons: holdValidation.blockedReasons,
          });
          return Promise.resolve();
        }
        const toggleCfg = normalizeToggleToRecordConfig(getToggleToRecordConfig());
        const toggleValidation = validateToggleAccelerator('mac', toggleCfg.macAccelerator);
        const nativeComboEnabled =
          toggleCfg.macMode !== 'custom' || toggleValidation.blockedReasons.length > 0;
        const canRegisterCustomToggle =
          !nativeComboEnabled && toggleValidation.blockedReasons.length === 0;
        console.info('[main] registering hold-to-record hotkey:', {
          platform: process.platform,
          key,
          delayMs: cfg.delayMs,
          nativeComboEnabled,
          toggleCfg,
          cfg,
          reason,
        });
        const registerAllHotkeys = () => {
          this.disposeGlobalHotkey = registerGlobalHoldRecorder(getOrCreateWindowForHotkey, {
            key,
            delayMs: cfg.delayMs,
            comboEnabled: nativeComboEnabled,
            reason,
          });
          clearToggleToRecordShortcut();
          if (canRegisterCustomToggle) {
            registerToggleToRecordShortcut(toggleValidation.normalizedAccelerator);
          } else if (toggleCfg.macMode === 'custom') {
            console.warn('[main] skip custom toggle hotkey register due to blocked reasons:', {
              accelerator: toggleCfg.macAccelerator,
              blocked: toggleValidation.blockedReasons,
            });
          }
        };
        // 先清理旧的热键（确保完全停止）
        if (this.disposeGlobalHotkey) {
          try {
            this.disposeGlobalHotkey();
            this.disposeGlobalHotkey = undefined; // 立即清空引用，防止重复调用
            clearToggleToRecordShortcut();
            comboRecordingActive = false;
            // 等待一点时间确保完全清理（特别是 macOS 需要 join 线程）
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
              }, 200); // macOS 需要更多时间 join 线程
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
            voiceSessionActiveSince = 0;
          }
        }
        if (voiceSessionActive) {
          pendingHotkeyReRegister = true;
          console.info(
            '[main] hotkey re-register requested but voice session active; will retry after stop. reason:',
            reason,
          );
          return;
        }
        if (isRegisteringHotkey) {
          // 关键：设置页快速连改时不能直接丢弃本次重注册请求，否则会出现“更换快捷键不生效”
          pendingHotkeyReRegister = true;
          console.warn('[main] hotkey registration already in progress, queue next run:', reason);
          return;
        }
        isRegisteringHotkey = true;
        try {
          await doRegisterHotkey(reason);
        } catch (error) {
          console.error('[main] Error in registerHotkey:', error);
        } finally {
          isRegisteringHotkey = false;
          // 若并发期间有新的重注册请求，当前轮结束后补跑一次（录音中则继续等待 voice-feedback 收口）
          if (pendingHotkeyReRegister && !voiceSessionActive) {
            pendingHotkeyReRegister = false;
            setTimeout(() => {
              void registerHotkey('pending-after-registering');
            }, 0);
          }
        }
      };

      // 初始注册
      registerHotkey('startup');
      this.reRegisterGlobalHotkey = registerHotkey;

      // 引导/特殊场景：临时挂起全局按住录音钩子（例如 mac 教程页内使用本地按键监听，避免 Option 抢焦点）
      ipcMain.handle('hotkey-set-suspended', async (_event, payload: unknown) => {
        const suspended = !!(payload && typeof payload === 'object' && (payload as any).suspended);
        const reason =
          (payload && typeof payload === 'object' && (payload as any).reason) || 'renderer-request';
        hotkeyTemporarilySuspended = suspended;
        try {
          if (suspended) {
            try {
              this.disposeGlobalHotkey?.();
            } catch {
              // ignore
            }
            this.disposeGlobalHotkey = undefined;
            clearToggleToRecordShortcut();
            comboRecordingActive = false;
            console.info('[main] global hold hotkey suspended by renderer:', { reason });
            return { success: true, suspended: true };
          }
          console.info('[main] global hold hotkey resumed by renderer:', { reason });
          await registerHotkey(`resume-from-renderer:${String(reason)}`);
          return { success: true, suspended: false };
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          return { success: false, suspended, error: err.message };
        }
      });

      // 轻量级钩子状态检查函数（异步，不阻塞）
      const checkHotkeyStatusLightweight = () => {
        // 使用 setTimeout 确保异步执行，不阻塞主线程
        setTimeout(() => {
          try {
            // 如果正在注册热键，避免在 dispose->start 的短窗口里读到 disabled 又触发新一轮重注册
            if (isRegisteringHotkey) return;
            if (accessibilityTrustedCached === false) return;
            const status = getHoldRecorderStatus();
            // 如果钩子未运行且不是禁用状态，尝试重启
            if (status.backend === 'native' && status.nativeIsRunning === false) {
              console.info('[main] window hidden: hotkey not running, attempting restart...');
              // 重置状态，确保重启不被阻止
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
              registerHotkey('window-hidden-check');
            } else if (status.backend === 'disabled') {
              // 如果完全禁用，也尝试重启
              console.info('[main] window hidden: hotkey disabled, attempting restart...');
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
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
      const windowHiddenCheckInterval = setInterval(() => {
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
      try {
        (windowHiddenCheckInterval as unknown as { unref?: () => void })?.unref?.();
      } catch {
        // ignore
      }
      app.on('will-quit', () => {
        try {
          clearInterval(windowHiddenCheckInterval);
        } catch {
          // ignore
        }
      });

      // macOS: 锁屏/休眠后，EventTap / 辅助功能状态可能发生变化；解锁/唤醒时做一次兜底恢复
      // 场景：开机自启时正处于锁屏界面，窗口 show 可能不生效；解锁后需要重新激活热键/窗口唤起链路
      {
        let lastHotkeyRestartAt = 0;
        let unlockRestartAttempts = 0;
        let unlockRestartTimers: NodeJS.Timeout[] = [];
        const clearUnlockRestartTimers = () => {
          for (const timer of unlockRestartTimers) {
            try {
              clearTimeout(timer);
            } catch {
              //
            }
          }
          unlockRestartTimers = [];
        };

        // 验证钩子是否成功启动（异步检查，不阻塞）
        const verifyHotkeyRunning = (reason: string, attempt: number): void => {
          // 延迟检查，给钩子启动时间
          setTimeout(() => {
            try {
              const st = getHoldRecorderStatus();
              if (st.backend === 'native' && st.nativeIsRunning === true) {
                console.info(
                  `[main] power event: ${reason}, hotkey verified running (attempt ${attempt})`,
                );
                unlockRestartAttempts = 0;
                clearUnlockRestartTimers();
                return;
              }
              // 如果未运行且还有重试机会，继续重试
              if (unlockRestartAttempts > 0 && attempt < 4) {
                console.warn(
                  `[main] power event: ${reason}, hotkey not running after attempt ${attempt}, will retry...`,
                );
              } else if (unlockRestartAttempts > 0) {
                console.error(
                  `[main] power event: ${reason}, hotkey failed to start after ${attempt} attempts`,
                );
                unlockRestartAttempts = 0;
                clearUnlockRestartTimers();
              }
            } catch (e) {
              console.warn('[main] Failed to verify hotkey status:', e);
            }
          }, 500);
        };

        const restartHotkey = (reason: string, bypassCooldown = false) => {
          try {
            const now = Date.now();
            // 解锁时的重启使用独立冷却时间，避免被常规冷却阻止
            if (!bypassCooldown) {
              if (now - lastHotkeyRestartAt < 1500) return;
            } else {
              // 解锁时使用更短的冷却（800ms），但仍避免过于频繁
              if (now - lastHotkeyRestartAt < 800) return;
            }
            lastHotkeyRestartAt = now;

            console.info(`[main] power event: ${reason}, re-registering hotkey...`);
            // 解锁/唤醒时强制重置录音状态，确保重启不被阻止
            if (reason.includes('unlock') || reason.includes('resume')) {
              voiceSessionActive = false;
              pendingHotkeyReRegister = false;
            }
            void registerHotkey(`power-${reason}`);
            // 验证重启是否成功
            if (reason.includes('unlock') || reason.includes('resume')) {
              verifyHotkeyRunning(reason, unlockRestartAttempts);
            }
          } catch (e) {
            console.warn('[main] Failed to re-register hotkey on power event:', e);
          }
        };

        // 优化的解锁重启机制：多次重试，逐步增加延迟
        const delayedRestart = (reason: string) => {
          unlockRestartAttempts = 1;
          clearUnlockRestartTimers();

          // 第一次尝试：立即（但绕过常规冷却）
          restartHotkey(reason, true);

          const scheduleRetry = (delayMs: number, attempt: number, suffix: string) => {
            const timer = setTimeout(() => {
              if (unlockRestartAttempts > 0) {
                unlockRestartAttempts = attempt;
                restartHotkey(`${reason}-${suffix}`, true);
                if (attempt >= 4) {
                  unlockRestartAttempts = 0; // 重置，避免无限重试
                }
              }
            }, delayMs);
            unlockRestartTimers.push(timer);
          };

          // 第二次尝试：延迟 1.5 秒
          scheduleRetry(1500, 2, 'retry-2');
          // 第三次尝试：延迟 3 秒
          scheduleRetry(3000, 3, 'retry-3');
          // 第四次尝试：延迟 5 秒（最后兜底）
          scheduleRetry(5000, 4, 'retry-4');
        };

        try {
          // 进入睡眠/锁屏：先停掉（释放 event tap / native hook）
          // 同时重置录音状态，确保解锁后重启不被阻止
          powerMonitor.on('suspend', () => {
            try {
              console.info('[main] power event: suspend, disposing hotkey hook...');
              voiceSessionActive = false; // 重置状态
              pendingHotkeyReRegister = false;
              try {
                if (
                  process.platform === 'darwin' &&
                  systemPreferences.isTrustedAccessibilityClient(false) === false
                ) {
                  console.warn(
                    '[main] Skipping keyhook stop on suspend due to missing accessibility permission',
                  );
                  // 权限缺失时 stop 可能卡死：不 stop，但也不要丢掉 disposer，避免后续重复启动多个 hook
                  hotkeySuppressedByPermission = true;
                } else {
                  this.disposeGlobalHotkey?.();
                }
              } catch {
                // 保守：失败也不丢 disposer，避免后续重启产生叠加 hook
              }
            } catch (e) {
              console.warn('[main] Failed to dispose hotkey on suspend:', e);
            }
          });
          powerMonitor.on('lock-screen', () => {
            try {
              console.info('[main] power event: lock-screen, disposing hotkey hook...');
              voiceSessionActive = false; // 重置状态
              pendingHotkeyReRegister = false;
              unlockRestartAttempts = 0; // 重置重试计数
              clearUnlockRestartTimers();
              try {
                if (
                  process.platform === 'darwin' &&
                  systemPreferences.isTrustedAccessibilityClient(false) === false
                ) {
                  console.warn(
                    '[main] Skipping keyhook stop on lock-screen due to missing accessibility permission',
                  );
                  // 权限缺失时 stop 可能卡死：不 stop，但也不要丢掉 disposer，避免后续重复启动多个 hook
                  hotkeySuppressedByPermission = true;
                } else {
                  this.disposeGlobalHotkey?.();
                }
              } catch {
                // 保守：失败也不丢 disposer，避免后续重启产生叠加 hook
              }
            } catch (e) {
              console.warn('[main] Failed to dispose hotkey on lock-screen:', e);
            }
          });

          // 唤醒/解锁：使用优化的多次重试机制
          powerMonitor.on('resume', () => {
            lastUserActiveAt = Date.now();
            delayedRestart('resume');
          });
          powerMonitor.on('unlock-screen', () => {
            lastUserActiveAt = Date.now();
            delayedRestart('unlock-screen');
          });
          // “长时间空闲/显示器休眠后回来”很多机器不触发 suspend/resume，
          // 但会触发 user-did-become-active。这里也做一次兜底恢复。
          powerMonitor.on('user-did-become-active', () => {
            lastUserActiveAt = Date.now();
            delayedRestart('user-did-become-active');
          });
        } catch (err) {
          console.warn('[main] Failed to attach powerMonitor listeners:', err);
        }
        app.on('will-quit', () => {
          unlockRestartAttempts = 0;
          clearUnlockRestartTimers();
        });
      }

      // macOS: 定期检查辅助功能权限状态和热键恢复（低频巡检，减少长期运行系统调用开销）
      if (process.platform === 'darwin') {
        let lastPermissionStatus: boolean | null = null;
        let lastHotkeyReRegisterTime = 0;
        const HOTKEY_RE_REGISTER_COOLDOWN = 5000; // 5秒内最多重新注册一次，避免频繁操作
        let lastPermissionRevokedNotifyAt = 0;
        const PERMISSION_CHECK_INTERVAL_MS = 15000;

        const permissionCheckInterval = setInterval(() => {
          try {
            const hasPermission = systemPreferences.isTrustedAccessibilityClient(false);
            accessibilityTrustedCached = hasPermission;
            if (lastPermissionStatus === null) {
              lastPermissionStatus = hasPermission;
            } else if (!lastPermissionStatus && hasPermission) {
              // 权限从无到有，重新注册热键
              console.info('[main] Accessibility permission granted, re-registering hotkey...');
              registerHotkey('accessibility-granted');
              lastPermissionStatus = hasPermission;
              lastHotkeyReRegisterTime = Date.now();
            } else if (lastPermissionStatus !== hasPermission) {
              const prev = lastPermissionStatus;
              lastPermissionStatus = hasPermission;
              if (!hasPermission) {
                hotkeySuppressedByPermission = true;
                console.warn('[main] Accessibility permission revoked');
                // 权限被撤销：立即取消正在进行/启动中的录音，避免用户出现“录音停不掉/卡住”的体验
                try {
                  if (voiceSessionActive) {
                    sendGlobalRecordAction('cancel');
                  }
                  voiceSessionActive = false;
                  pendingHotkeyReRegister = false;
                  voiceSessionActiveSince = 0;
                } catch {
                  //
                }

                // 仅提示一次，避免每次轮询都弹通知
                const now = Date.now();
                if (prev === true && now - lastPermissionRevokedNotifyAt > 15_000) {
                  lastPermissionRevokedNotifyAt = now;
                  tryShowMacNotification({
                    title: 'Sensetype：需要辅助功能权限',
                    body: '检测到“辅助功能”权限已关闭：按住说话热键已停用。点击打开系统设置重新开启。',
                    onClick: () => {
                      try {
                        // 这里不强行置顶窗口，避免再一次压住系统弹窗；仅打开系统设置页引导
                        void shell.openExternal(
                          'x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility',
                        );
                      } catch {
                        //
                      }
                    },
                  });
                }
              }
            }

            // 检查热键状态：如果 watchdog 检测到失效，立即重新注册
            if (hasPermission && hotkeySuppressedByPermission) {
              hotkeySuppressedByPermission = false;
            }
            if (hasPermission) {
              const status = getHoldRecorderStatus();
              if (status.backend === 'native' && status.nativeIsRunning === false) {
                // watchdog 检测到失效，立即重新注册
                const now = Date.now();
                if (now - lastHotkeyReRegisterTime > HOTKEY_RE_REGISTER_COOLDOWN) {
                  console.warn('[main] Hotkey watchdog detected failure, re-registering...');
                  registerHotkey('watchdog-detected-failure');
                  lastHotkeyReRegisterTime = now;
                }
              } else if (status.backend === 'disabled') {
                // 完全禁用，也尝试重新注册
                const now = Date.now();
                if (now - lastHotkeyReRegisterTime > HOTKEY_RE_REGISTER_COOLDOWN) {
                  console.warn('[main] Hotkey disabled, re-registering...');
                  registerHotkey('disabled-recovery');
                  lastHotkeyReRegisterTime = now;
                }
              } else {
                // 兜底：native hook 偶发“静默失效”（isRunning=true 但不再产出事件）。
                // 只在用户近期有活动时触发，避免用户离开电脑时频繁 stop/start。
                const now = Date.now();
                const userRecentlyActive = now - lastUserActiveAt < 20 * 60 * 1000; // 20分钟内有过 user-did-become-active/resume/unlock
                const lastEvt = typeof status.lastEventAt === 'number' ? status.lastEventAt : 0;
                // 以前是 20min，反馈“用着用着”更像 3~10min 级别的静默失效，这里收紧阈值
                const eventTooOld = lastEvt > 0 && now - lastEvt > 6 * 60 * 1000; // 6分钟无事件
                const everStarted = status.everStarted === true;
                if (
                  userRecentlyActive &&
                  everStarted &&
                  eventTooOld &&
                  status.backend === 'native' &&
                  status.nativeIsRunning === true
                ) {
                  // 针对“静默失效”的预防性重启，使用更长的冷却时间（10分钟），避免因 lastEventAt 不更新导致死循环重启
                  if (now - lastHotkeyReRegisterTime > 10 * 60 * 1000) {
                    console.warn(
                      '[main] stale lastEventAt while nativeIsRunning=true, forcing hotkey re-register...',
                      { lastEventAt: status.lastEventAt, lastEventType: status.lastEventType },
                    );
                    registerHotkey('user-active-stale-lastEvent');
                    lastHotkeyReRegisterTime = now;
                  }
                }
              }
            }
          } catch (error) {
            console.error('[main] Error checking accessibility permission:', error);
          }
        }, PERMISSION_CHECK_INTERVAL_MS);
        try {
          (permissionCheckInterval as unknown as { unref?: () => void })?.unref?.();
        } catch {
          // ignore
        }

        // 前台恢复策略：仅在热键状态异常时才重注册，避免窗口焦点变化引起 stop/start 抖动。
        const tryRecoverHotkeyOnForeground = (reason: 'activate' | 'window-focus') => {
          try {
            if (isRewriteOverlayVisible()) return;
            const hasPermission = systemPreferences.isTrustedAccessibilityClient(false);
            if (!hasPermission) return;

            const status = getHoldRecorderStatus();
            const hotkeyUnhealthy =
              status.backend === 'disabled' ||
              (status.backend === 'native' && status.nativeIsRunning === false);
            if (!hotkeyUnhealthy) return;

            const now = Date.now();
            if (now - lastHotkeyReRegisterTime <= HOTKEY_RE_REGISTER_COOLDOWN) return;

            console.info('[main] foreground recovery: re-registering hotkey...', {
              reason,
              backend: status.backend,
              nativeIsRunning: status.nativeIsRunning,
              lastEventType: status.lastEventType,
            });
            registerHotkey(reason === 'activate' ? 'activate-recovery' : 'window-focus-recovery');
            lastHotkeyReRegisterTime = now;
          } catch (error) {
            console.error(`[main] Error re-registering hotkey on ${reason}:`, error);
          }
        };

        // 监听应用激活事件
        app.on('activate', () => {
          tryRecoverHotkeyOnForeground('activate');
        });

        // 监听窗口焦点变化
        app.on('browser-window-focus', () => {
          tryRecoverHotkeyOnForeground('window-focus');
        });

        // 在应用退出时清理定时器
        app.on('will-quit', () => {
          clearInterval(permissionCheckInterval);
        });
      }

      // 渲染进程请求：把文本粘贴到"当前正在输入"的外部应用
      ipcMain.handle('paste-text', async (_event, text: string) => {
        if (typeof text !== 'string' || !text) return;
        await pasteTextToActiveApp(text);
      });

      // 渲染进程请求：把文本“注入”到当前前台应用（更适合逐 token）
      // 优先走 native keyhook.sendText；若不可用则回退到剪贴板粘贴。
      ipcMain.handle('inject-text', async (_event, text: string) => {
        if (typeof text !== 'string' || !text) return;
        try {
          const keyhook = tryLoadKeyhook<{ sendText?: (t: string) => boolean }>();
          if (keyhook?.sendText) {
            const ok = keyhook.sendText(text);
            if (ok) return;
          }
        } catch {
          // ignore, fallback below
        }
        await pasteTextToActiveApp(text);
      });

      // 渲染进程请求：从"当前前台应用"读取选中文本（跨应用）
      ipcMain.handle('get-selected-text', async () => {
        return await readSelectedTextFromActiveApp();
      });

      // 渲染进程请求：检查并请求麦克风权限
      ipcMain.handle('request-microphone-permission', async () => {
        if (process.platform !== 'darwin') {
          return { granted: true, status: 'not-macos' };
        }
        try {
          const status = systemPreferences.getMediaAccessStatus('microphone');
          if (status === 'granted') {
            return { granted: true, status: 'granted' };
          }
          const result = await systemPreferences.askForMediaAccess('microphone');
          return { granted: result, status: result ? 'granted' : 'denied' };
        } catch (error) {
          console.error('[permission] Error requesting microphone permission:', error);
          return { granted: false, status: 'error', error: String(error) };
        }
      });

      // 渲染进程请求：检查麦克风权限状态（只检查，不触发系统弹窗/不打开系统设置）
      ipcMain.handle('check-microphone-permission', async () => {
        if (process.platform !== 'darwin') {
          return { granted: true, status: 'not-macos' };
        }
        try {
          const status = systemPreferences.getMediaAccessStatus('microphone');
          return { granted: status === 'granted', status };
        } catch (error) {
          console.error('[permission] Error checking microphone permission:', error);
          return { granted: false, status: 'error', error: String(error) };
        }
      });

      // 渲染进程请求：检查屏幕录制权限状态（只检查，不触发系统弹窗）
      ipcMain.handle('check-screen-recording-permission', async () => {
        if (process.platform !== 'darwin') {
          return { granted: true, status: 'not-macos' };
        }
        try {
          const status = systemPreferences.getMediaAccessStatus('screen');
          return { granted: status === 'granted', status };
        } catch (error) {
          console.error('[permission] Error checking screen-recording permission:', error);
          return { granted: false, status: 'error', error: String(error) };
        }
      });

      // 渲染进程请求：检查辅助功能权限状态（只检查，不触发系统弹窗/不打开系统设置）
      ipcMain.handle('check-accessibility-permission', async () => {
        if (process.platform !== 'darwin') {
          return { granted: true, status: 'not-macos' };
        }
        try {
          const trusted = systemPreferences.isTrustedAccessibilityClient(false);
          accessibilityTrustedCached = trusted;
          return {
            granted: trusted,
            status: trusted ? 'granted' : 'denied',
            promptSuppressed: true,
          };
        } catch (error) {
          console.error('[permission] Error checking accessibility permission:', error);
          return { granted: false, status: 'error', error: String(error) };
        }
      });

      // 渲染进程请求：用户在前台尝试按住录音键时触发（不做系统检测，只基于缓存/冷却决定是否弹一次）
      ipcMain.handle('accessibility-prompt-for-hotkey', async (_event, payload?: unknown) => {
        if (process.platform !== 'darwin') return { prompted: false, reason: 'not-macos' };
        try {
          // 每次触发前都刷新一次，避免缓存过期导致“以为已授权就不弹”
          refreshAccessibilityTrusted();
          const force = !!(payload && typeof payload === 'object' && (payload as any).force);
          // 引导页点击“允许”：无论是否已授权/是否刚弹过，都强制打开系统设置页（确保用户有可见反馈）
          if (force) {
            try {
              focusWindowForSystemPrompt();
            } catch {
              // ignore
            }
            try {
              // x64 上不要调用 isTrustedAccessibilityClient(true)（历史上可能卡死）；arm64 可尝试触发一次系统 prompt
              if (process.arch !== 'x64') {
                try {
                  accessibilityTrustedCached = systemPreferences.isTrustedAccessibilityClient(true);
                } catch {
                  // ignore
                }
              }
            } catch {
              // ignore
            }
            await openAccessibilitySettings();
            return { prompted: true, reason: 'force-open-settings' };
          }

          if (accessibilityTrustedCached === true)
            return { prompted: false, reason: 'already-granted' };
          promptAccessibility('user-hotkey', { force: false });
          return { prompted: true, reason: 'requested' };
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          return { prompted: false, reason: 'error', error: err.message };
        }
      });
      // 渲染进程请求：读取/更新“按住录音”热键配置（mac/win 分开，立即生效）
      ipcMain.handle('settings-get-hold-to-record', async () => {
        return getHoldToRecordConfig();
      });
      ipcMain.handle('settings-set-hold-to-record', async (_event, patch: unknown) => {
        const merged = { ...getHoldToRecordConfig(), ...(patch || {}) };
        const holdValidation = validateHoldKey('mac', merged.macKey);
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
        const v = validateToggleAccelerator('mac', raw.macAccelerator);
        return {
          config: raw,
          blockedReasons: raw.macMode === 'custom' ? v.blockedReasons : [],
          warningReasons: raw.macMode === 'custom' ? v.warningReasons : [],
        };
      });
      ipcMain.handle('settings-set-toggle-to-record', async (_event, payload: unknown) => {
        const cur = getToggleToRecordConfig();
        const nextRaw = normalizeToggleToRecordConfig({ ...cur, ...(payload || {}) });
        const v = validateToggleAccelerator('mac', nextRaw.macAccelerator);
        if (nextRaw.macMode === 'custom' && v.blockedReasons.length > 0) {
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
          warningReasons: next.macMode === 'custom' ? v.warningReasons : [],
        };
      });

      // 设置页：读取/更新开机自启（mac/win 都支持；开发态仅保存不改系统设置）
      ipcMain.handle('settings-get-auto-launch', async () => {
        return { enabled: getAutoLaunchEnabled() };
      });
      ipcMain.handle('settings-set-auto-launch', async (_event, payload: unknown) => {
        const enabled = (payload as { enabled?: unknown } | null)?.enabled;
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
        const deviceId = (payload as { deviceId?: unknown } | null)?.deviceId;
        const next = setPreferredMicDeviceId(deviceId);
        console.info('[main] updated preferred mic deviceId:', next);
        return { deviceId: next };
      });

      // 设置页：读取/更新系统提示音开关（影响 shell.beep）
      ipcMain.handle('settings-get-system-sound', async () => {
        return { enabled: getSystemPromptSoundEnabled() };
      });
      ipcMain.handle('settings-set-system-sound', async (_event, payload: unknown) => {
        const enabled = (payload as { enabled?: unknown } | null)?.enabled;
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
          const value = (payload as { value?: unknown } | null)?.value;
          const next = setPreferredLanguageVariant(value);
          console.info('[main] updated preferred language variant:', next);
          return { value: next };
        },
      );

      // 设置页/诊断：获取热键状态
      ipcMain.handle('hotkey-get-status', async () => {
        const status = getHoldRecorderStatus();
        // mac：若渲染进程偶发漏发 recording-stopped，但原生热键事件已到 stop/cancel，
        // 则在设置页轮询时主动修正状态，保证“结束录音后可修改按键”。
        if (voiceSessionActive) {
          const lastEventType = status.lastEventType;
          const lastEventAt = typeof status.lastEventAt === 'number' ? status.lastEventAt : 0;
          const shouldRecoverStaleSession =
            (lastEventType === 'stop' ||
              lastEventType === 'cancel' ||
              // 某些长录音场景里 stop 会被后续 keyup 覆盖，仍应视为“已结束按住录音”
              lastEventType === 'keyup') &&
            lastEventAt > 0 &&
            // 不依赖 lastVoiceFeedbackAt，避免 rewrite/recognition 反馈把时间戳顶掉导致无法解锁
            lastEventAt >= (voiceSessionActiveSince || 0);
          if (shouldRecoverStaleSession) {
            voiceSessionActive = false;
            voiceSessionActiveSince = 0;
            this.windowCreator?.setRecordingState?.(false);
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
        } catch (e) {
          const err = e instanceof Error ? e : new Error(String(e));
          return { success: false, error: err.message };
        }
      });

      // 渲染进程：显示/关闭系统级重写结果悬浮窗
      ipcMain.on(
        'rewrite-overlay-show',
        (
          _event,
          payload: {
            text?: string;
            questionText?: string;
            // 引导页专用：展示重写结果时保留主窗口可见，避免“应用消失”
            scene?: string;
          },
        ) => {
          console.log(1231231222222223);
          return;

          try {
            showRewriteOverlay(payload?.text || '', {
              questionText: payload?.questionText || '',
              skipHidePrimaryWindows: payload?.scene === 'init-tutorial',
            });
          } catch (e) {
            console.warn('[main] rewrite-overlay-show failed:', e);
          }
        },
      );
      // 渲染进程：显示重写结果悬浮窗（可等待/可回传错误）
      ipcMain.handle(
        'rewrite-overlay-show',
        async (
          _event,
          payload: {
            text?: string;
            questionText?: string;
            // 引导页专用：展示重写结果时保留主窗口可见，避免“应用消失”
            scene?: string;
          },
        ) => {
          try {
            await showRewriteOverlayAndWait(payload?.text || '', {
              questionText: payload?.questionText || '',
              skipHidePrimaryWindows: payload?.scene === 'init-tutorial',
            });
            return { success: true };
          } catch (e: any) {
            console.log(999);
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
        // macOS：少数环境下全局 Option/Alt 钩子可能在弹出/关闭悬浮窗后进入异常状态；
        // 在用户明确结束一次交互（点 X / 复制并关闭）时，做一次轻量自愈重注册。
        //
        // ⚠️ Intel(macOS x64)：我们遇到过在权限切换/安全输入等场景下，重注册过程中 stop/start 原生钩子
        // 会导致主线程卡死（表现为“复制并关闭”点击后应用无响应）。
        // 为了避免影响用户关闭悬浮窗的基本交互，这里在 Intel 上禁用该自愈动作。
        try {
          if (process.platform === 'darwin') {
            if (process.arch === 'x64') return;
            setTimeout(() => {
              try {
                this.reRegisterGlobalHotkey?.('rewrite-overlay-hide');
              } catch (e) {
                console.warn('[main] hotkey re-register after rewrite-overlay-hide failed:', e);
              }
            }, 80);
          }
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
            status?: string;
            volumes?: number[] | null;
            message?: string;
            previewText?: string;
            autoHideMs?: number;
            resetTimer?: boolean;
            nonBlockingHint?: boolean;
          },
        ) => {
          const status =
            payload?.status === 'speaking' ||
            payload?.status === 'loading' ||
            payload?.status === 'notice' ||
            payload?.status === 'error'
              ? payload.status
              : 'silent';
          updateVoiceIndicator({
            visible: !!payload?.visible,
            status,
            volumes: payload?.volumes || null,
            message: typeof payload?.message === 'string' ? payload.message : undefined,
            previewText: typeof payload?.previewText === 'string' ? payload.previewText : undefined,
            autoHideMs: typeof payload?.autoHideMs === 'number' ? payload.autoHideMs : undefined,
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
          // hovered 时允许点击按钮；否则恢复鼠标穿透
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
        // 用户主动点击角标退出：短时间屏蔽 native start，防止“刚取消就被残留按键又启动”
        try {
          suppressHoldRecorderStart(1500, 'voice-indicator-action');
        } catch {
          //
        }
        // 立即复位主进程会话态，避免后续热键重注册/状态机被“录音中”错误锁住
        voiceSessionActive = false;
        voiceSessionActiveSince = 0;
        comboRecordingActive = false;
        pendingHotkeyReRegister = false;
        try {
          this.windowCreator?.setRecordingState?.(false);
        } catch {
          //
        }
        try {
          // 广播给所有业务窗口：复用 renderer 现有 global-record cancel 逻辑
          for (const w of BrowserWindow.getAllWindows()) {
            if (!w || w.isDestroyed()) continue;
            if (w.webContents === event.sender) continue; // skip indicator window
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
        (_event, payload: { type?: string; message?: string; detail?: unknown }) => {
          const type = payload?.type;
          lastVoiceFeedbackAt = Date.now();
          try {
            const cfg = getHoldToRecordConfig();
            const holdKeyName = describeHoldKeyForPlatform(cfg);
            if (type === 'recording-started') {
              voiceSessionActive = true;
              this.windowCreator?.setRecordingState?.(true);
              voiceSessionActiveSince = voiceSessionActiveSince || Date.now();
              if (getSystemPromptSoundEnabled()) shell.beep();
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip(
                  `SenseAudio AI语音输入法：录音中…（松开 ${holdKeyName} 停止）`,
                );
              }
              tryShowMacNotification({
                title: 'SenseAudio AI语音输入法',
                body: `正在录音…（松开 ${holdKeyName} 停止）`,
              });
            } else if (type === 'recording-stopped') {
              voiceSessionActive = false;
              voiceSessionActiveSince = 0;
              comboRecordingActive = false;
              // 稳定性兜底：
              // 渲染进程录音结束后会进入识别/上传阶段；若后续流程卡住（例如网络/接口超时），
              // 以前会导致主窗口在隐藏到托盘后长期保持“不节流”，从而出现后台 CPU 维持偏高、偶发无响应。
              // 这里在 recording-stopped 即刻恢复“非录音态”，让隐藏窗口可重新启用节流。
              this.windowCreator?.setRecordingState?.(false);
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip('SenseAudio AI语音输入法：录音结束，正在识别…');
              }
              tryShowMacNotification({
                title: 'SenseAudio AI语音输入法',
                body: '录音结束，正在识别…',
              });
            } else if (type === 'recognition-done') {
              // 兜底：即使某次未收到 recording-stopped，也不要一直锁住重注册
              voiceSessionActive = false;
              this.windowCreator?.setRecordingState?.(false);
              voiceSessionActiveSince = 0;
              comboRecordingActive = false;
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip('SenseAudio AI语音输入法：识别完成（已自动写入/粘贴）');
              }
              tryShowMacNotification({
                title: 'SenseAudio AI语音输入法',
                body: '识别完成（已自动写入/粘贴）',
              });
            } else if (type === 'recognition-error') {
              voiceSessionActive = false;
              this.windowCreator?.setRecordingState?.(false);
              voiceSessionActiveSince = 0;
              comboRecordingActive = false;
              if (this.tray && !this.tray.isDestroyed()) {
                this.tray.setToolTip('SenseAudio AI语音输入法：识别失败（点击查看）');
              }
              tryShowMacNotification({
                title: 'SenseAudio AI语音输入法：识别失败',
                body: payload?.message || '请检查麦克风/权限/网络后重试',
              });
            }
          } catch {
            //
          }

          // 若之前因为录音进行中而延迟了热键重注册，这里在录音结束后补一次。
          if (!voiceSessionActive && pendingHotkeyReRegister) {
            pendingHotkeyReRegister = false;
            try {
              console.info('[main] voice session ended, applying pending hotkey re-register...');
              registerHotkey('pending-after-voice');
            } catch (e) {
              console.warn('[main] Failed to apply pending hotkey re-register:', e);
            }
          }
        },
      );
    });
  }

  onRunning() {
    // macOS: 点击 Dock 时唤起窗口
    app.on('activate', (_event, hasVisibleWindows) => {
      // 点击重写悬浮窗会触发 activate；此时不应把主窗口强行拉到前台。
      try {
        if (isRewriteOverlayVisible()) return;
      } catch {
        // ignore
      }
      if (process.platform === 'darwin' && hasVisibleWindows) return;
      try {
        // 优先唤起登录窗口（锁屏自启时，登录窗可能被创建但 show 不生效；解锁后点击 Dock 需要能唤起）
        const loginWin = this.windowCreator.getLoginWindow?.() || null;
        if (loginWin && !loginWin.isDestroyed()) {
          try {
            if (loginWin.isMinimized?.()) loginWin.restore();
          } catch {
            // ignore
          }
          loginWin.show();
          loginWin.focus();
          return;
        }

        // 其次唤起主窗口（若窗口存在但被 hide，不应只因为存在就不显示）
        const win = this.windowCreator.getWindow();
        if (win && !win.isDestroyed()) {
          try {
            if (win.isMinimized?.()) win.restore();
          } catch {
            // ignore
          }
          win.show();
          win.focus();
          return;
        }

        // 都不存在才重建
        this.createWindow();
      } catch (e) {
        console.error('[main] activate handler failed:', e);
        try {
          this.createWindow();
        } catch {
          // ignore
        }
      }
    });
  }

  onQuit() {
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') {
        app.quit();
      }
    });

    app.on('will-quit', () => {
      globalShortcut.unregisterAll();
      // macOS：当用户在运行中撤销辅助功能权限时，stop() 在少数场景可能卡住主线程。
      // 退出时优先保证“能退出”，权限不可用则跳过 stop。
      try {
        if (
          process.platform === 'darwin' &&
          systemPreferences.isTrustedAccessibilityClient(false) === false
        ) {
          console.warn(
            '[main] Skipping keyhook stop on quit due to missing accessibility permission',
          );
        } else {
          this.disposeGlobalHotkey?.();
        }
      } catch {
        // 保守：检查失败也不要阻塞退出
      }
      // 清理 Tray，避免销毁后事件监听器仍然触发
      if (this.tray && !this.tray.isDestroyed()) {
        this.tray.removeAllListeners();
        this.tray.destroy();
        this.tray = undefined;
      }
    });

    app.on('before-quit', () => {
      // 退出流程先做一次“录音/热键收敛”，避免 Fn+Space 场景下在退出瞬间被残留按键重新拉起录音
      try {
        suppressHoldRecorderStart(5000, 'before-quit');
      } catch {
        //
      }
      // 标记全局 quitting：让其它窗口/模块在 close 拦截时放行（若有用到）
      try {
        (app as any).__sensetype_is_quitting = true;
      } catch {
        //
      }
      try {
        for (const w of BrowserWindow.getAllWindows()) {
          if (!w || w.isDestroyed()) continue;
          try {
            w.webContents.send('global-record', { action: 'cancel' });
          } catch {
            //
          }
          try {
            w.webContents.send('voice-indicator-set', { visible: false, status: 'silent' });
          } catch {
            //
          }
        }
      } catch {
        //
      }
      // 提前释放热键钩子，避免 quit 期间继续接收原生按键事件
      try {
        this.disposeGlobalHotkey?.();
        this.disposeGlobalHotkey = undefined;
      } catch {
        //
      }
      // 提前清理 Tray，避免退出时触发事件
      if (this.tray && !this.tray.isDestroyed()) {
        this.tray.removeAllListeners();
        this.tray.destroy();
        this.tray = undefined;
      }

      // 强制退出兜底：
      // - 有些窗口的 close 会 preventDefault（如长录音窗口优雅关闭），可能导致 quit 卡住
      // - 这里先给一点时间让渲染进程停录音，然后强制销毁所有窗口并退出进程
      if (process.platform === 'darwin') {
        try {
          setTimeout(() => {
            try {
              for (const w of BrowserWindow.getAllWindows()) {
                try {
                  if (w && !w.isDestroyed()) w.destroy();
                } catch {
                  //
                }
              }
            } catch {
              //
            }
          }, 1200);
        } catch {
          //
        }
        try {
          setTimeout(() => {
            try {
              app.exit(0);
            } catch {
              // ignore
            }
          }, 2500);
        } catch {
          //
        }
      }
    });
  }
}

export default new ElectronMain();
