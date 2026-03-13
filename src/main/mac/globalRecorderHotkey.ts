import { app, BrowserWindow, Notification, shell, systemPreferences } from 'electron';
import type { HoldToRecordKey } from '../common/settingsStore';
import type { HoldRecorderStatus, RecorderAction } from '../common/holdRecorderTypes';
import { dispatchGlobalRecord } from '../common/globalRecordDispatcher';
import { getSystemPromptSoundEnabled } from '../common/settingsStore';
import { getKeyhookPackageName, tryLoadKeyhook } from './keyhookLoader';
import { hideRewriteOverlay } from './rewriteOverlayWindow';

// 热键与窗口解耦：不在热键路径里主动恢复窗口焦点，避免层级抖动。

function logOptionDiag(tag: string, getWindow: () => BrowserWindow | undefined) {
  try {
    const w = getWindow();
    const focused = BrowserWindow.getFocusedWindow?.();
    const info = {
      hasWindow: !!w,
      isDestroyed: !!w?.isDestroyed?.(),
      isVisible: !!w?.isVisible?.(),
      isFocused: !!w?.isFocused?.(),
      isMinimized: !!w?.isMinimized?.(),
      appHidden:
        typeof (app as unknown as { isHidden?: () => boolean }).isHidden === 'function'
          ? !!(app as unknown as { isHidden: () => boolean }).isHidden()
          : null,
      dockVisible:
        app.dock && typeof app.dock.isVisible === 'function' ? !!app.dock.isVisible() : null,
      focusedWindowId: focused?.id ?? null,
      ts: Date.now(),
    };
    void info;
    // console.info(`[option-diag][hotkey] ${tag}`, info);
  } catch {
    // console.warn('[option-diag][hotkey] log failed:', error);
  }
}

function macSystemNotificationsEnabled(): boolean {
  // 用户诉求：macOS 不需要任何系统通知（快捷键提示/权限提示等）。
  // 如需临时排障，可设置环境变量开启：SENSETYPE_MAC_NOTIFICATIONS=1
  const v = String(process.env.SENSETYPE_MAC_NOTIFICATIONS || '')
    .trim()
    .toLowerCase();
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

const status: HoldRecorderStatus = {
  backend: 'disabled',
  nativeVersion: null,
  nativeIsRunning: null,
  everStarted: false,
  lastEventType: 'unknown',
  lastEventAt: null,
  lastRestartAt: null,
  lastError: null,
  lastRegisterReason: null,
  registerCount: 0,
  disposeCount: 0,
};

// 当用户从角标主动“取消/退出”时，短时间屏蔽 start 事件，避免残留按键状态导致立刻重启录音。
let suppressStartUntilMs = 0;

export function suppressHoldRecorderStart(durationMs = 1200, reason = 'manual-cancel') {
  const d = Number.isFinite(durationMs) ? Math.max(0, Math.floor(durationMs)) : 1200;
  const until = Date.now() + d;
  suppressStartUntilMs = Math.max(suppressStartUntilMs, until);
  status.lastError = `start suppressed until ${new Date(suppressStartUntilMs).toISOString()} (${reason})`;
}

export function getHoldRecorderStatus(): HoldRecorderStatus {
  return { ...status };
}

function describeKey(key: HoldToRecordKey): string {
  if (key === 'option') return 'Option/Alt';
  if (key === 'ralt') return 'Right Alt';
  if (key === 'control') return 'Control/Ctrl';
  if (key === 'shift') return 'Shift';
  if (key === 'command') return 'Command';
  return String(key);
}

function safeSend(
  action: RecorderAction,
  getWindow: () => BrowserWindow | undefined,
  meta?: { hotkeyMode?: 'single' | 'combo' },
) {
  const win = getWindow();
  if (!win || win.isDestroyed()) {
    console.warn('[global-alt-recorder] window not available, cannot send event');
    return;
  }
  dispatchGlobalRecord(
    win,
    { action, ...(meta || {}) },
    {
      disableBackgroundThrottlingForStart: true,
      logTag: '[global-alt-recorder]',
    },
  );
}

let lastHintAt = 0;
function hintOnce(body: string) {
  const now = Date.now();
  if (now - lastHintAt < 400) return;
  lastHintAt = now;
  try {
    if (getSystemPromptSoundEnabled()) shell.beep();
  } catch {
    //
  }
  try {
    if (macSystemNotificationsEnabled() && Notification.isSupported()) {
      new Notification({ title: 'Sensetype', body }).show();
    }
  } catch {
    //
  }
}

function checkAccessibilityPermission(): boolean {
  try {
    return systemPreferences.isTrustedAccessibilityClient(false);
  } catch {
    return false;
  }
}

export function registerGlobalHoldRecorder(
  getWindow: () => BrowserWindow | undefined,
  opts: { key: HoldToRecordKey; delayMs: number; comboEnabled?: boolean; reason?: string },
) {
  const { key, delayMs, comboEnabled = true, reason } = opts;
  status.key = key;
  status.delayMs = delayMs;
  status.lastError = null;
  status.lastRegisterReason = typeof reason === 'string' ? reason : null;
  status.lastRestartAt = Date.now();
  status.registerCount = (status.registerCount || 0) + 1;

  // macOS：全局键盘钩子需要"辅助功能/Accessibility"权限
  // 未授权时不启动钩子，避免启动即崩溃；且这里绝不触发系统授权弹窗（拒绝后会反复弹）。
  const trusted = checkAccessibilityPermission();
  if (!trusted) {
    console.warn(
      '[global-alt-recorder] Accessibility permission not granted. Hotkey disabled until enabled.',
    );
    hintOnce('未获得辅助功能权限：无法使用长按 ' + describeKey(key) + ' 录音（可在设置中开启）');
    status.backend = 'disabled';
    status.nativeIsRunning = null;
    status.lastError = 'accessibility permission not granted';
    return () => {
      status.disposeCount = (status.disposeCount || 0) + 1;
    };
  }
  console.info('[global-alt-recorder] Accessibility permission granted.');

  try {
    console.info('[global-hold-recorder] starting native keyhook with:', { key, delayMs });
    // NOTE(mac): 不要默认开启原生模块逐键 debug 输出。
    // 逐键日志会导致明显卡顿（尤其是登录/输入框场景）。
    // 如需排查问题，请手动设置环境变量：SENSETYPE_KEYHOOK_DEBUG=1

    const keyhook = tryLoadKeyhook<{
      start: (
        opts: { delayMs?: number; key?: string; comboEnabled?: boolean },
        onEvent: (e: { type: 'start' | 'stop' | 'cancel' }) => void,
      ) => boolean;
      stop: () => void;
      isRunning?: () => boolean;
      version?: () => string;
    }>();
    if (!keyhook) {
      throw new Error(`native keyhook not available: ${getKeyhookPackageName()}`);
    }

    try {
      const ver = typeof keyhook.version === 'function' ? keyhook.version() : 'unknown';
      console.info('[global-alt-recorder] keyhook version:', ver);
      // 这个版本串包含编译日期时间（例如 "sensetype-keyhook Jan 14 20..."），
      // 仅用于排障，避免在用户环境弹系统通知干扰使用。
      // 仅开发环境展示版本串，避免打包版打扰用户。
      if (!app.isPackaged && process.env.SENSETYPE_KEYHOOK_DEBUG) {
        hintOnce(`keyhook: ${ver}`);
      }
      status.nativeVersion = ver;
    } catch (err) {
      console.warn('[global-alt-recorder] keyhook.version() failed:', err);
      status.nativeVersion = null;
    }

    const hookOpts = { delayMs, key, comboEnabled };
    let activeHotkeyMode: 'single' | 'combo' = 'single';
    let comboSignalUntilMs = 0;
    const rememberComboSignal = (eventKey?: string) => {
      const k = String(eventKey || '').toLowerCase();
      // mac 原生层的 Fn+Space 会先发 keydown/keyup(fn/space)，再发 start/stop。
      if (k === 'fn' || k === 'space') {
        comboSignalUntilMs = Date.now() + 1200;
      }
    };
    const resolveStartHotkeyMode = (): 'single' | 'combo' => {
      const now = Date.now();
      return now <= comboSignalUntilMs ? 'combo' : 'single';
    };

    const onNativeEvent = (e: {
      type: 'start' | 'stop' | 'cancel' | 'keydown' | 'keyup';
      key?: string;
    }) => {
      // 优化：移除高频同步权限检查，避免主线程卡顿。
      // 权限状态由 index.ts 中的 watchdog 定期检查维护。

      status.lastEventType = e?.type || 'unknown';
      status.lastEventAt = Date.now();

      // 转发 Fn 键事件给渲染进程（用于 UI 反馈）
      if (e?.type === 'keydown' || e?.type === 'keyup') {
        rememberComboSignal(e?.key);
        const win = getWindow();
        if (win && !win.isDestroyed()) {
          dispatchGlobalRecord(
            win,
            { action: e.type, key: e.key },
            {
              logTag: '[global-alt-recorder]',
            },
          );
        }
        return;
      }

      if (e?.type === 'start') {
        logOptionDiag('native-start-before-guards', getWindow);
        if (Date.now() < suppressStartUntilMs) {
          console.info('[global-alt-recorder] start event suppressed by cooldown window');
          return;
        }
        status.everStarted = true;
        activeHotkeyMode = resolveStartHotkeyMode();
        // 本次 start 已消费组合键信号，避免污染下一轮开始。
        comboSignalUntilMs = 0;
        console.info('[global-alt-recorder] keyhook event: start');
        // 按下语音唤起键：自动收起重写悬浮窗，避免遮挡/抢焦点
        try {
          hideRewriteOverlay();
        } catch {
          // ignore
        }

        // 热键链路不主动改窗口焦点：避免出现“按下快捷键引起窗口层级抖动/回弹”。

        hintOnce(`开始录音（按住 ${describeKey(key)}）`);
        safeSend('start', getWindow, { hotkeyMode: activeHotkeyMode });
        logOptionDiag('native-start-after-send', getWindow);
      }
      if (e?.type === 'stop') {
        console.info('[global-alt-recorder] keyhook event: stop');
        hintOnce('停止录音，正在识别…');
        safeSend('stop', getWindow, { hotkeyMode: activeHotkeyMode });
        activeHotkeyMode = 'single';
        logOptionDiag('native-stop-after-send', getWindow);
      }
      if (e?.type === 'cancel') {
        console.info('[global-alt-recorder] keyhook event: cancel - 原生模块检测到组合键');
        console.info('[global-alt-recorder] 正在发送 cancel 事件到渲染进程...');
        hintOnce('检测到组合键：已取消语音');
        safeSend('cancel', getWindow, { hotkeyMode: activeHotkeyMode });
        activeHotkeyMode = 'single';
        console.info('[global-alt-recorder] cancel 事件已发送');
      }
    };

    const ok = keyhook.start(hookOpts, onNativeEvent);
    if (ok) {
      status.backend = 'native';
      status.nativeIsRunning =
        typeof keyhook.isRunning === 'function' ? !!keyhook.isRunning() : null;
      console.info('[global-alt-recorder] using native keyhook (swallow supported).');
      hintOnce(`录音热键就绪：${describeKey(key)} 长按录音（已拦截按键）`);

      let watchdog: NodeJS.Timeout | null = null;
      let isDisposed = false;
      if (typeof keyhook.isRunning === 'function') {
        watchdog = setInterval(() => {
          try {
            if (isDisposed) return;
            const running = !!keyhook.isRunning?.();
            status.nativeIsRunning = running;
            if (!running) {
              status.lastError = 'detected not running by watchdog';
              setTimeout(() => {
                if (!isDisposed) {
                  const stillRunning = !!keyhook.isRunning?.();
                  if (!stillRunning) {
                    status.lastRestartAt = Date.now();
                    console.warn(
                      '[global-alt-recorder] native keyhook not running (confirmed), status updated for outer re-register',
                    );
                  }
                }
              }, 500);
            }
          } catch (err) {
            console.warn('[global-alt-recorder] keyhook watchdog check failed:', err);
            status.lastError = String(err);
          }
        }, 10000);
        // Electron/Node 的 Timeout 通常有 unref；这里用可选调用避免引入 any
        try {
          watchdog?.unref?.();
        } catch {
          //
        }
      }

      return () => {
        isDisposed = true;
        try {
          if (watchdog) {
            clearInterval(watchdog);
            watchdog = null;
          }
          try {
            keyhook.stop();
            status.backend = 'disabled';
            status.nativeIsRunning = null;
          } catch (err) {
            console.warn('[global-alt-recorder] error stopping keyhook:', err);
            status.backend = 'disabled';
            status.nativeIsRunning = null;
          }
        } catch (err) {
          console.warn('[global-alt-recorder] error in dispose:', err);
          status.backend = 'disabled';
          status.nativeIsRunning = null;
        }
        status.disposeCount = (status.disposeCount || 0) + 1;
      };
    }

    console.warn('[global-alt-recorder] native keyhook start() returned false.');
    hintOnce('原生钩子启动失败：请重启应用或重新安装原生模块。');
    status.backend = 'disabled';
    status.lastError = 'native start() returned false';
    return () => {
      status.backend = 'disabled';
      status.nativeIsRunning = null;
      status.disposeCount = (status.disposeCount || 0) + 1;
    };
  } catch (err) {
    console.warn('[global-alt-recorder] native keyhook not available.', err);
    hintOnce('原生钩子不可用：请重新编译/安装 keyhook 原生模块后重启。');
    status.backend = 'disabled';
    status.lastError = err instanceof Error ? err.message : String(err);
    return () => {
      status.backend = 'disabled';
      status.nativeIsRunning = null;
      status.disposeCount = (status.disposeCount || 0) + 1;
    };
  }
}
