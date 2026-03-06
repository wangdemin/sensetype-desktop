import { BrowserWindow, shell } from 'electron';
import type { WebContents } from 'electron';
import type { HoldToRecordKey } from '../common/settingsStore';
import type { HoldRecorderStatus, RecorderAction } from '../common/holdRecorderTypes';
import { getSystemPromptSoundEnabled } from '../common/settingsStore';
import { loadKeyhookOrThrow } from './keyhookLoader';
import { hideRewriteOverlay } from './rewriteOverlayWindow';

const status: HoldRecorderStatus = {
  backend: 'disabled',
  nativeVersion: null,
  nativeIsRunning: null,
  lastEventType: 'unknown',
  lastEventAt: null,
  lastRestartAt: null,
  lastError: null,
  lastRegisterReason: null,
  registerCount: 0,
  disposeCount: 0,
};

export function getHoldRecorderStatus(): HoldRecorderStatus {
  return { ...status };
}

function describeKey(key: HoldToRecordKey): string {
  if (key === 'option') return 'Option/Alt';
  if (key === 'ralt') return 'Right Alt';
  if (key === 'control') return 'Control/Ctrl';
  if (key === 'shift') return 'Shift';
  if (key === 'command') return 'Command';
  if (key === 'lalt') return 'Left Alt';
  if (key === 'lctrl') return 'Left Ctrl';
  if (key === 'lshift') return 'Left Shift';
  if (key === 'lwin') return 'Left Win';
  if (key === 'rctrl') return 'Right Ctrl';
  if (key === 'alt') return 'Alt';
  if (key === 'win') return 'Win';
  return String(key);
}

const pendingActionAfterLoad = new WeakMap<
  WebContents,
  { action: RecorderAction; hotkeyMode?: 'single' | 'combo' }
>();
const loadFlushAttached = new WeakSet<WebContents>();

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

  try {
    const wc = win.webContents;
    if (wc.isDestroyed()) {
      console.warn('[global-alt-recorder] webContents is destroyed');
      return;
    }

    if (wc.isLoading()) {
      // Best-effort immediate send while loading. If renderer listener is already mounted,
      // this avoids waiting for did-finish-load.
      try {
        wc.send('global-record', { action, ...(meta || {}) });
      } catch {
        // ignore immediate send failure
      }

      // Keep only the latest action during page loading and flush once after load completes.
      pendingActionAfterLoad.set(wc, { action, ...(meta || {}) });
      if (loadFlushAttached.has(wc)) return;
      loadFlushAttached.add(wc);

      wc.once('did-finish-load', () => {
        loadFlushAttached.delete(wc);
        try {
          const pending = pendingActionAfterLoad.get(wc);
          pendingActionAfterLoad.delete(wc);
          if (!pending) return;
          if (win && !win.isDestroyed() && !wc.isDestroyed()) {
            wc.send('global-record', pending);
            console.info(`[global-alt-recorder] flushed event '${pending.action}' after page load`);
          }
        } catch (error) {
          console.warn('[global-alt-recorder] failed to send event after load:', error);
        }
      });
      return;
    }

    wc.send('global-record', { action, ...(meta || {}) });
    console.info(`[global-alt-recorder] sent event '${action}' to window`);
  } catch (error) {
    console.warn('[global-alt-recorder] failed to send event to window:', error);
  }
}

let lastHintAt = 0;
let lastToggleState = false; // Track Ctrl+Win toggle state across restarts
function hintOnce(body: string) {
  // Keep message payload for future diagnostics while Windows notifications stay disabled.
  void body;
  const now = Date.now();
  if (now - lastHintAt < 400) return;
  lastHintAt = now;
  try {
    if (getSystemPromptSoundEnabled()) shell.beep();
  } catch {
    //
  }
  // NOTE(win): 不在 Windows 下弹系统通知（按住热键会高频触发，干扰使用）。
  // 如需排障可用日志/开启 SENSETYPE_KEYHOOK_DEBUG 等调试输出。
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

  try {
    console.info('[global-hold-recorder] starting native keyhook with:', { key, delayMs });
    // NOTE(win): 不要在开发环境默认开启原生模块逐键 debug 输出，
    // 否则会在终端持续刷 keydown/keyup 日志。
    // 如需排查问题，请手动设置环境变量：SENSETYPE_KEYHOOK_DEBUG=1

    const keyhook = loadKeyhookOrThrow<{
      start: (
        opts: {
          delayMs?: number;
          key?: string;
          initialToggleState?: boolean;
          comboEnabled?: boolean;
        },
        onEvent: (e: { type: 'start' | 'stop' | 'cancel' }) => void,
      ) => boolean;
      stop: () => void;
      isRunning?: () => boolean;
      isHoldDown?: () => boolean;
      version?: () => string;
    }>();

    try {
      const ver = typeof keyhook.version === 'function' ? keyhook.version() : 'unknown';
      console.info('[global-alt-recorder] keyhook version:', ver);
      // 这个版本串包含编译日期时间（例如 "sensetype-keyhook Jan 14 20..."），
      // 仅用于排障，避免在用户环境弹系统通知干扰使用。
      if (process.env.SENSETYPE_KEYHOOK_DEBUG) {
        hintOnce(`keyhook: ${ver}`);
      }
      status.nativeVersion = ver;
    } catch (err) {
      console.warn('[global-alt-recorder] keyhook.version() failed:', err);
      status.nativeVersion = null;
    }

    const hookOpts = { delayMs, key, initialToggleState: lastToggleState, comboEnabled };
    // Win 启动早期，渲染层 global-record 监听可能尚未挂上：
    // native 已打印 start，但渲染没收到时就会表现为“按下没反应，过几秒才好”。
    // 这里对 start 做短周期重放；一旦收到 stop/cancel 就立刻停止重放，避免残留 start。
    const START_REPLAY_DELAYS_MS = [180, 520, 980, 1600, 2500, 3800, 5400, 7600];
    let emitSeq = 0;
    let activeHotkeyMode: 'single' | 'combo' = 'single';
    const replayTimers = new Set<NodeJS.Timeout>();
    const clearReplayTimers = () => {
      if (replayTimers.size === 0) return;
      for (const t of replayTimers) {
        try {
          clearTimeout(t);
        } catch {
          //
        }
      }
      replayTimers.clear();
    };
    const sendStartWithReplay = (hotkeyMode: 'single' | 'combo') => {
      clearReplayTimers();
      const seq = ++emitSeq;
      safeSend('start', getWindow, { hotkeyMode });
      for (const delay of START_REPLAY_DELAYS_MS) {
        const timer = setTimeout(() => {
          replayTimers.delete(timer);
          if (seq !== emitSeq) return;
          try {
            if (typeof keyhook.isHoldDown === 'function' && !keyhook.isHoldDown()) return;
          } catch {
            // ignore state probe error
          }
          safeSend('start', getWindow, { hotkeyMode });
        }, delay);
        try {
          (timer as unknown as { unref?: () => void }).unref?.();
        } catch {
          //
        }
        replayTimers.add(timer);
      }
    };
    const stopStartReplay = () => {
      emitSeq += 1;
      clearReplayTimers();
    };

    const onNativeEvent = (e: { type: 'start' | 'stop' | 'cancel' }) => {
      status.lastEventType = e?.type || 'unknown';
      status.lastEventAt = Date.now();

      // Update toggle state tracking
      if (e?.type === 'start') lastToggleState = true;
      else if (e?.type === 'stop' || e?.type === 'cancel') lastToggleState = false;

      if (e?.type === 'start') {
        // win 下：
        // - Right-Alt 按住录音时 isHoldDown=true（单键）
        // - Ctrl+Win 组合键触发 start 时 isHoldDown=false（组合键）
        activeHotkeyMode = (() => {
          try {
            if (typeof keyhook.isHoldDown === 'function') {
              return keyhook.isHoldDown() ? 'single' : 'combo';
            }
          } catch {
            // ignore
          }
          return 'single';
        })();
        console.info('[global-alt-recorder] keyhook event: start');
        // 按下语音唤起键：自动收起重写悬浮窗，避免遮挡/抢焦点
        try {
          hideRewriteOverlay();
        } catch {
          // ignore
        }
        hintOnce(`开始录音（按住 ${describeKey(key)}）`);
        sendStartWithReplay(activeHotkeyMode);
      }
      if (e?.type === 'stop') {
        stopStartReplay();
        console.info('[global-alt-recorder] keyhook event: stop');
        hintOnce('停止录音，正在识别…');
        safeSend('stop', getWindow, { hotkeyMode: activeHotkeyMode });
      }
      if (e?.type === 'cancel') {
        stopStartReplay();
        console.info('[global-alt-recorder] keyhook event: cancel - 原生模块检测到组合键');
        hintOnce('检测到组合键：已取消语音');
        safeSend('cancel', getWindow, { hotkeyMode: activeHotkeyMode });
      }
    };

    const ok = keyhook.start(hookOpts, onNativeEvent);
    if (ok) {
      status.backend = 'native';
      status.nativeIsRunning =
        typeof keyhook.isRunning === 'function' ? !!keyhook.isRunning() : null;
      console.info('[global-alt-recorder] using native keyhook (swallow supported).');
      hintOnce(`录音热键就绪：${describeKey(key)} 长按录音（已拦截按键）`);

      return () => {
        try {
          try {
            keyhook.stop();
          } catch (err) {
            console.warn('[global-alt-recorder] error stopping keyhook:', err);
          }
        } finally {
          stopStartReplay();
          status.backend = 'disabled';
          status.nativeIsRunning = null;
          status.disposeCount = (status.disposeCount || 0) + 1;
        }
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
