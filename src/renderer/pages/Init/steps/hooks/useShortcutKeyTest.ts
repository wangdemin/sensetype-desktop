import { useCallback, useEffect, useRef, useState } from 'react';
import { setInitKeyTestSuppressRecording } from '@/renderer/hooks/globalRecordSuppression';

type IpcRendererLike = {
  invoke?: (channel: string, ...args: unknown[]) => Promise<unknown>;
  on?: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => void;
  off?: (channel: string, handler: (event: unknown, ...args: unknown[]) => void) => void;
};

type GlobalRecordPayload = {
  action?: 'start' | 'stop' | 'cancel' | 'keydown' | 'keyup';
  key?: string;
};

function getGlobalRecordPayload(args: unknown[]): GlobalRecordPayload | null {
  const first = args?.[0];
  if (!first || typeof first !== 'object') return null;
  const p = first as { action?: unknown; key?: unknown };
  return {
    action: typeof p.action === 'string' ? (p.action as GlobalRecordPayload['action']) : undefined,
    key: typeof p.key === 'string' ? p.key : undefined,
  };
}

export function useShortcutKeyTest(params: {
  enabled: boolean;
  chordMode: boolean;
  ipcRenderer?: IpcRendererLike | null;
  isWin: boolean;
}) {
  const { enabled, chordMode, ipcRenderer, isWin } = params;

  const [isShortcutPressed, setIsShortcutPressed] = useState(false);
  const [isSpacePressed, setIsSpacePressed] = useState(false);
  const [isChordSecondPressed, setIsChordSecondPressed] = useState(false);
  const [isKeyPressed, setIsKeyPressed] = useState(false);
  const [hasPressedOnce, setHasPressedOnce] = useState(false);

  const originalDelayMsRef = useRef<number | null>(null);

  const reset = useCallback(() => {
    setIsShortcutPressed(false);
    setIsSpacePressed(false);
    setIsChordSecondPressed(false);
    setIsKeyPressed(false);
    setHasPressedOnce(false);
  }, []);

  // 进入按键测试阶段时，重置状态
  useEffect(() => {
    if (!enabled) return;
    reset();
  }, [enabled, reset]);

  // 初始化按键测试期间只做按键可用性验证，不触发真正语音录制。
  useEffect(() => {
    setInitKeyTestSuppressRecording(enabled);
    return () => {
      setInitKeyTestSuppressRecording(false);
    };
  }, [enabled]);

  // 监听全局快捷键事件（enabled 时）
  useEffect(() => {
    if (!enabled || !ipcRenderer?.on) return;

    const handleGlobalRecord = (_: unknown, ...args: unknown[]) => {
      const payload = getGlobalRecordPayload(args);
      if (chordMode) {
        // 双键模式 (Fn + Space / Ctrl + Win)
        // 只用 keydown/keyup 驱动 UI，避免 start/stop 导致释放后仍显示按下
        if (payload?.action === 'keydown') {
          if (payload?.key === 'fn') setIsChordSecondPressed(true);
          if (payload?.key === 'space') setIsSpacePressed(true);
        } else if (payload?.action === 'keyup') {
          if (payload?.key === 'fn') setIsChordSecondPressed(false);
          if (payload?.key === 'space') setIsSpacePressed(false);
        }
      } else {
        // 单键模式 (Hold to record)
        if (payload?.action === 'start') {
          setIsShortcutPressed(true);
        } else if (payload?.action === 'stop' || payload?.action === 'cancel') {
          setIsShortcutPressed(false);
        }
      }
    };

    // 注意：不要把 ipcRenderer.on/off 解构成独立函数，否则会丢失 this 绑定，触发 `_events` 相关报错
    ipcRenderer.on('global-record', handleGlobalRecord);
    return () => {
      ipcRenderer?.off?.('global-record', handleGlobalRecord);
    };
  }, [chordMode, enabled, ipcRenderer]);

  // 双键测试：本地键盘事件判定“同时按下”
  useEffect(() => {
    if (!enabled || !chordMode) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.repeat) return;
      if (isWin) {
        // Windows: Ctrl + Win（Meta）
        if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
          setIsChordSecondPressed(true);
        }
        if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
          setIsSpacePressed(true);
        }
        // 兜底：部分环境下 Win 键事件不下发，但 metaKey 会体现在其他按键事件上
        if (e.metaKey) {
          setIsChordSecondPressed(true);
        }
      } else {
        // macOS: Fn + Space
        if (e.code === 'Space' || e.key === ' ') setIsSpacePressed(true);
        if (e.code === 'Fn' || e.key === 'Fn' || e.keyCode === 255) setIsChordSecondPressed(true);
      }
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (isWin) {
        if (e.key === 'Control' || e.code === 'ControlLeft' || e.code === 'ControlRight') {
          setIsSpacePressed(false);
        }
        if (e.key === 'Meta' || e.code === 'MetaLeft' || e.code === 'MetaRight') {
          setIsChordSecondPressed(false);
        }
        // 兜底：当任意键松开且 metaKey=false，可纠正 Win 键状态
        if (!e.metaKey) {
          setIsChordSecondPressed(false);
        }
      } else {
        if (e.code === 'Space' || e.key === ' ') setIsSpacePressed(false);
        if (e.code === 'Fn' || e.key === 'Fn' || e.keyCode === 255) setIsChordSecondPressed(false);
      }
    };
    const onBlur = () => {
      setIsSpacePressed(false);
      setIsChordSecondPressed(false);
    };

    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('keyup', onKeyUp, true);
    window.addEventListener('blur', onBlur);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('blur', onBlur);
    };
  }, [chordMode, enabled, isWin]);

  // 统一计算“是否按下”（双键页=Win: Ctrl+Win / Mac: Fn+Space；单键页=按住快捷键）
  useEffect(() => {
    if (!enabled) return;

    const pressed = chordMode ? isSpacePressed && isChordSecondPressed : isShortcutPressed;
    setIsKeyPressed((prev) => (prev === pressed ? prev : pressed));
    if (pressed) setHasPressedOnce(true);
  }, [chordMode, enabled, isChordSecondPressed, isShortcutPressed, isSpacePressed]);

  // 按键测试阶段：临时把延迟设为 0，确保按下即响应
  useEffect(() => {
    // 注意：invoke 也可能依赖 this；同时要让 TS 明确它一定存在
    const invoke = ipcRenderer?.invoke?.bind(ipcRenderer);
    if (!enabled || !invoke) return;
    let stopped = false;
    (async () => {
      try {
        const current = (await invoke('settings-get-hold-to-record')) as { delayMs?: unknown };
        const delayMs =
          typeof current?.delayMs === 'number' ? current.delayMs : Number(current?.delayMs);
        if (!Number.isFinite(delayMs)) return;
        originalDelayMsRef.current = delayMs;
        if (!stopped) await invoke('settings-set-hold-to-record', { delayMs: 0 });
      } catch {
        // ignore
      }
    })();

    return () => {
      stopped = true;
      const prev = originalDelayMsRef.current;
      if (typeof prev !== 'number' || !Number.isFinite(prev)) return;
      void invoke('settings-set-hold-to-record', { delayMs: prev }).catch(() => undefined);
    };
  }, [enabled, ipcRenderer]);

  return {
    isShortcutPressed,
    isSpacePressed,
    isChordSecondPressed,
    isKeyPressed,
    hasPressedOnce,
    reset,
  };
}
