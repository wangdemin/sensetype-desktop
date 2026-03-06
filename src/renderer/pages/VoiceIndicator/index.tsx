import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import styles from './index.module.scss';

type IndicatorStatus = 'speaking' | 'silent' | 'loading' | 'notice' | 'error';

type IndicatorPayload = {
  visible?: boolean;
  status?: IndicatorStatus;
  volumes?: number[] | null;
  message?: string;
  nonBlockingHint?: boolean;
  previewText?: string;
  text?: string;
  tip?: string;
  autoHideMs?: number;
  resetTimer?: boolean;
};

type IpcRendererLike = {
  on?: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void;
  send?: (channel: string, payload?: unknown) => void;
};

type WindowWithElectron = Window & {
  electronAPI?: { ipcRenderer?: IpcRendererLike };
  require?: (moduleName: string) => { ipcRenderer?: IpcRendererLike } | undefined;
};
type TimerId = number;

const BAR_COUNT = 12;
const DEFAULT_WIDTH = 178;
const DEFAULT_HEIGHT = 72;
const PREVIEW_HEIGHT = 240;
const PREVIEW_WIDTH = 420;
const MIN_WIDTH = 178;
const MAX_WIDTH = 720;

function clamp01(v: number) {
  return Math.max(0, Math.min(1, v));
}

function clamp(v: number, min: number, max: number) {
  return Math.max(min, Math.min(max, v));
}

function formatElapsed(ms: number) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function normalizeStatus(input: unknown): IndicatorStatus {
  if (input === 'speaking') return 'speaking';
  if (input === 'silent') return 'silent';
  if (input === 'loading') return 'loading';
  if (input === 'notice') return 'notice';
  if (input === 'error') return 'error';
  return 'silent';
}

function getIpcRenderer(): IpcRendererLike | null {
  const win = window as WindowWithElectron;

  try {
    const injected = win.electronAPI?.ipcRenderer;
    if (injected) return injected as IpcRendererLike;
  } catch {
    // ignore
  }

  try {
    const req = win.require;
    if (typeof req === 'function') {
      return req('electron')?.ipcRenderer ?? null;
    }
  } catch {
    // ignore
  }

  return null;
}

export default function VoiceIndicatorPage() {
  const [renderVisible, setRenderVisible] = useState(false);
  const [isHiding, setIsHiding] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [status, setStatus] = useState<IndicatorStatus>('silent');
  const [volumes, setVolumes] = useState<number[] | null>(null);
  const [messageText, setMessageText] = useState('');
  const [hintText, setHintText] = useState('');
  const [previewText, setPreviewText] = useState('');
  const [timerVisible, setTimerVisible] = useState(false);
  const [timerText, setTimerText] = useState('00:00');

  const ipcRef = useRef<IpcRendererLike | null>(null);
  const textRef = useRef<HTMLDivElement | null>(null);
  const hintRef = useRef<HTMLDivElement | null>(null);
  const previewTextRef = useRef<HTMLDivElement | null>(null);
  const hideTimerRef = useRef<TimerId | null>(null);
  const hintHideTimerRef = useRef<TimerId | null>(null);
  const noticeHideTimerRef = useRef<TimerId | null>(null);
  const timerIntervalRef = useRef<TimerId | null>(null);
  const recordStartedAtRef = useRef<number | null>(null);
  const recordElapsedMsRef = useRef(0);
  const visibleRef = useRef(false);
  const hidingRef = useRef(false);
  const lastResizeWRef = useRef(DEFAULT_WIDTH);
  const lastResizeHRef = useRef(DEFAULT_HEIGHT);
  // 在 notice/error 展示期间，缓存"录音中"状态，notice 结束后恢复
  const noticeActiveRef = useRef(false);
  const pendingRecordingStatusRef = useRef<{
    status: IndicatorStatus;
    volumes: number[] | null;
    previewText: string;
  } | null>(null);

  const requestResize = useCallback((width: number, height = DEFAULT_HEIGHT) => {
    try {
      const w = clamp(Math.round(width || DEFAULT_WIDTH), MIN_WIDTH, MAX_WIDTH);
      const h = Math.max(50, Math.round(height || DEFAULT_HEIGHT));
      if (Math.abs(w - lastResizeWRef.current) < 2 && Math.abs(h - lastResizeHRef.current) < 2)
        return;
      lastResizeWRef.current = w;
      lastResizeHRef.current = h;
      ipcRef.current?.send?.('voice-indicator-resize', { width: w, height: h });
    } catch {
      // ignore
    }
  }, []);

  const updateTimerText = useCallback(() => {
    setTimerText(formatElapsed(recordElapsedMsRef.current));
  }, []);

  const stopTimer = useCallback(() => {
    if (timerIntervalRef.current) {
      window.clearInterval(timerIntervalRef.current);
      timerIntervalRef.current = null;
    }
    if (recordStartedAtRef.current) {
      recordElapsedMsRef.current = Date.now() - recordStartedAtRef.current;
      recordStartedAtRef.current = null;
    }
    updateTimerText();
  }, [updateTimerText]);

  const startTimer = useCallback(() => {
    if (timerIntervalRef.current) return;
    recordStartedAtRef.current = Date.now() - recordElapsedMsRef.current;
    timerIntervalRef.current = window.setInterval(() => {
      if (!recordStartedAtRef.current) return;
      recordElapsedMsRef.current = Date.now() - recordStartedAtRef.current;
      updateTimerText();
    }, 250);
    updateTimerText();
  }, [updateTimerText]);

  const resetTimer = useCallback(() => {
    stopTimer();
    recordElapsedMsRef.current = 0;
    setTimerVisible(false);
    setTimerText('00:00');
  }, [stopTimer]);

  const clearHintText = useCallback(() => {
    if (hintHideTimerRef.current) {
      window.clearTimeout(hintHideTimerRef.current);
      hintHideTimerRef.current = null;
    }
    setHintText('');
  }, []);

  const show = useCallback(() => {
    if (hideTimerRef.current) {
      window.clearTimeout(hideTimerRef.current);
      hideTimerRef.current = null;
    }
    if (visibleRef.current && !hidingRef.current) return;
    visibleRef.current = true;
    hidingRef.current = false;
    setRenderVisible(true);
    setIsHiding(false);
  }, []);

  const hide = useCallback(() => {
    if (!visibleRef.current || hidingRef.current) return;
    hidingRef.current = true;
    setIsHiding(true);
    hideTimerRef.current = window.setTimeout(() => {
      visibleRef.current = false;
      hidingRef.current = false;
      setRenderVisible(false);
      setIsHiding(false);
      setIsHovered(false);
      clearHintText();
      setPreviewText('');
      resetTimer();
      noticeActiveRef.current = false;
      pendingRecordingStatusRef.current = null;
    }, 190);
  }, [clearHintText, resetTimer]);

  const barHeights = useMemo(() => {
    const src = Array.isArray(volumes) && volumes.length ? volumes : new Array(BAR_COUNT).fill(0.3);
    return Array.from({ length: BAR_COUNT }).map((_, i) => {
      const v = clamp01(src[i] ?? 0);
      return Math.round(3 + 17 * v);
    });
  }, [volumes]);

  useLayoutEffect(() => {
    try {
      if (hintText) {
        const hintEl = hintRef.current;
        if (hintEl) {
          const extra = 12 * 2 + 6 * 2 + 20;
          const measured = (hintEl.scrollWidth || hintEl.clientWidth || 0) + extra;
          requestResize(measured, DEFAULT_HEIGHT);
          return;
        }
      }

      if (status === 'notice' || status === 'error') {
        const textEl = textRef.current;
        if (!textEl) return;
        // indicator padding (12*2) + textWrap padding (6*2) + small safety
        const extra = 12 * 2 + 6 * 2 + 18;
        const measured = (textEl.scrollWidth || textEl.clientWidth || 0) + extra;
        requestResize(measured, DEFAULT_HEIGHT);
        return;
      }

      const showPreview =
        !!previewText &&
        (status === 'speaking' || status === 'silent' || status === 'loading') &&
        !messageText;
      if (showPreview) {
        // 预览框开启时放大窗口，避免上方文本被裁切。
        requestResize(PREVIEW_WIDTH, PREVIEW_HEIGHT);
        return;
      }

      requestResize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    } catch {
      // ignore
    }
  }, [status, messageText, hintText, previewText, requestResize]);

  useEffect(() => {
    const previewEl = previewTextRef.current;
    if (!previewEl || !previewText) return;
    // 新增文本时自动滚到最新位置，避免截断感。
    previewEl.scrollTop = previewEl.scrollHeight;
  }, [previewText]);

  useEffect(() => {
    const html = document.documentElement;
    const body = document.body;
    const rootEl = document.getElementById('root');

    const prev = {
      htmlBackground: html.style.background,
      htmlOverflow: html.style.overflow,
      bodyBackground: body.style.background,
      bodyOverflow: body.style.overflow,
      bodyMargin: body.style.margin,
      rootWidth: rootEl?.style.width ?? '',
      rootHeight: rootEl?.style.height ?? '',
      rootBackground: rootEl?.style.background ?? '',
      rootOverflow: rootEl?.style.overflow ?? '',
    };

    html.style.background = 'transparent';
    html.style.overflow = 'hidden';
    body.style.background = 'transparent';
    body.style.overflow = 'hidden';
    body.style.margin = '0';
    if (rootEl) {
      rootEl.style.width = '100vw';
      rootEl.style.height = '100vh';
      rootEl.style.background = 'transparent';
      rootEl.style.overflow = 'hidden';
    }

    return () => {
      html.style.background = prev.htmlBackground;
      html.style.overflow = prev.htmlOverflow;
      body.style.background = prev.bodyBackground;
      body.style.overflow = prev.bodyOverflow;
      body.style.margin = prev.bodyMargin;
      if (rootEl) {
        rootEl.style.width = prev.rootWidth;
        rootEl.style.height = prev.rootHeight;
        rootEl.style.background = prev.rootBackground;
        rootEl.style.overflow = prev.rootOverflow;
      }
    };
  }, [hide, resetTimer, startTimer, stopTimer, requestResize, updateTimerText]);

  useEffect(() => {
    const ipc = getIpcRenderer();
    ipcRef.current = ipc;
    if (!ipc?.on) return;

    const onHovered = (...args: unknown[]) => {
      const payload = (args[1] as { hovered?: boolean } | undefined) ?? undefined;
      try {
        setIsHovered(!!payload?.hovered);
      } catch {
        // ignore
      }
    };

    const onSet = (...args: unknown[]) => {
      const payload = (args[1] as IndicatorPayload | undefined) ?? undefined;
      try {
        const visible = !!payload?.visible;
        const nextStatus = normalizeStatus(payload?.status);
        const nextVolumes = Array.isArray(payload?.volumes) ? payload?.volumes : null;
        const nextPreviewText =
          typeof payload?.previewText === 'string' ? payload.previewText.trim() : '';
        const messageLike = payload?.message ?? payload?.text ?? payload?.tip;
        const message = typeof messageLike === 'string' ? messageLike : '';
        const autoHideMs = payload?.autoHideMs;
        const resetTimerNow = !!payload?.resetTimer;
        const nonBlockingHint = !!payload?.nonBlockingHint;
        const hasMessage = message.length > 0;
        const isRecordingView =
          visible && !hasMessage && (nextStatus === 'speaking' || nextStatus === 'silent');
        const isLoadingView = visible && !hasMessage && nextStatus === 'loading';

        if (resetTimerNow) {
          resetTimer();
        }

        if (nonBlockingHint) {
          if (!visible || !hasMessage) {
            clearHintText();
            return;
          }
          show();
          setHintText(message);
          if (hintHideTimerRef.current) {
            window.clearTimeout(hintHideTimerRef.current);
            hintHideTimerRef.current = null;
          }
          const ms = typeof autoHideMs === 'number' ? autoHideMs : 1600;
          hintHideTimerRef.current = window.setTimeout(
            () => {
              hintHideTimerRef.current = null;
              setHintText('');
            },
            Math.max(300, ms),
          );
          return;
        }

        if (nextStatus === 'notice' || nextStatus === 'error') {
          show();
          clearHintText();
          setMessageText(hasMessage ? message : '');
          setPreviewText('');
          setStatus(nextStatus);
          setVolumes(nextVolumes);
          setTimerVisible(false);
          // 不调用 stopTimer()，保持计时器继续跑，只是隐藏显示
          noticeActiveRef.current = true;
          if (noticeHideTimerRef.current) {
            window.clearTimeout(noticeHideTimerRef.current);
            noticeHideTimerRef.current = null;
          }
          const ms = typeof autoHideMs === 'number' ? autoHideMs : 1600;
          noticeHideTimerRef.current = window.setTimeout(() => {
            noticeHideTimerRef.current = null;
            noticeActiveRef.current = false;
            // notice 结束后：如果有缓存的录音状态，恢复显示；否则正常 hide
            const pending = pendingRecordingStatusRef.current;
            pendingRecordingStatusRef.current = null;
            if (pending) {
              setMessageText('');
              setStatus(pending.status);
              setVolumes(pending.volumes);
              setPreviewText(pending.previewText);
              setTimerVisible(true);
              startTimer();
            } else {
              hide();
            }
          }, ms);
          return;
        }

        if (hasMessage) {
          if (visible) {
            show();
            clearHintText();
            setMessageText(message);
            setPreviewText('');
            setStatus('notice');
            setVolumes(nextVolumes);
            setTimerVisible(false);
            // 不调用 stopTimer()，保持计时器继续跑
          } else {
            hide();
            setPreviewText('');
          }
          return;
        }

        const shouldPreResizePreview =
          visible &&
          !!nextPreviewText &&
          (nextStatus === 'speaking' || nextStatus === 'silent' || nextStatus === 'loading');
        if (shouldPreResizePreview) {
          // 预览首次出现前先放大窗口，避免从小窗瞬间跳大导致“闪一下”。
          requestResize(PREVIEW_WIDTH, PREVIEW_HEIGHT);
        }

        // 如果当前正在展示 notice，缓存录音状态，等 notice 结束后恢复
        if (
          noticeActiveRef.current &&
          visible &&
          (nextStatus === 'speaking' || nextStatus === 'silent' || nextStatus === 'loading')
        ) {
          pendingRecordingStatusRef.current = {
            status: nextStatus,
            volumes: nextVolumes,
            previewText: nextPreviewText,
          };
          return;
        }

        if (visible) {
          show();
          setStatus(nextStatus);
          setVolumes(nextVolumes);
          setPreviewText(nextPreviewText);
        } else {
          // 录音真正结束：取消 notice 恢复定时器，清理缓存状态
          if (noticeHideTimerRef.current) {
            window.clearTimeout(noticeHideTimerRef.current);
            noticeHideTimerRef.current = null;
          }
          noticeActiveRef.current = false;
          pendingRecordingStatusRef.current = null;
          hide();
          clearHintText();
          setPreviewText('');
        }

        setMessageText('');

        if (!visible) {
          resetTimer();
        } else if (isRecordingView) {
          setTimerVisible(true);
          startTimer();
        } else {
          stopTimer();
          const showTimer = isLoadingView && recordElapsedMsRef.current > 0;
          setTimerVisible(showTimer);
          updateTimerText();
        }
      } catch (err) {
        console.error('[voice-indicator] Error processing message:', err);
      }
    };

    ipc.on('voice-indicator-hovered', onHovered);
    ipc.on('voice-indicator-set', onSet);

    return () => {
      try {
        ipc.removeListener?.('voice-indicator-hovered', onHovered);
      } catch {
        // ignore
      }
      try {
        ipc.removeListener?.('voice-indicator-set', onSet);
      } catch {
        // ignore
      }
    };
  }, [
    clearHintText,
    hide,
    requestResize,
    resetTimer,
    show,
    startTimer,
    stopTimer,
    updateTimerText,
  ]);

  useEffect(() => {
    return () => {
      if (hideTimerRef.current) {
        window.clearTimeout(hideTimerRef.current);
        hideTimerRef.current = null;
      }
      if (hintHideTimerRef.current) {
        window.clearTimeout(hintHideTimerRef.current);
        hintHideTimerRef.current = null;
      }
      if (noticeHideTimerRef.current) {
        window.clearTimeout(noticeHideTimerRef.current);
        noticeHideTimerRef.current = null;
      }
      if (timerIntervalRef.current) {
        window.clearInterval(timerIntervalRef.current);
        timerIntervalRef.current = null;
      }
    };
  }, []);

  const handleStopClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    try {
      e.preventDefault();
      e.stopPropagation();
    } catch {
      // ignore
    }
    try {
      ipcRef.current?.send?.('voice-indicator-action', { action: 'cancel' });
    } catch {
      // ignore
    }
  };

  return (
    <div className={styles.root}>
      {renderVisible ? (
        <div
          className={`${styles.indicator} ${isHovered ? styles.hovered : ''} ${
            isHiding ? styles.hiding : ''
          }`}
        >
          {(status === 'speaking' || status === 'silent' || status === 'loading') && previewText ? (
            <div className={styles.previewWrap}>
              <div className={styles.previewBox}>
                <div ref={previewTextRef} className={styles.previewText}>
                  {previewText}
                </div>
              </div>
            </div>
          ) : null}
          {(status === 'speaking' || status === 'silent' || status === 'loading') && hintText ? (
            <div className={styles.hintWrap}>
              <div ref={hintRef} className={styles.hintText}>
                {hintText}
              </div>
            </div>
          ) : null}

          <button className={styles.stopBtn} title="停止 / 取消" onClick={handleStopClick}>
            ×
          </button>
          <div className={`${styles.row} ${timerVisible ? styles.hasTimer : ''}`}>
            {status === 'silent' ? (
              <div className={styles.dots}>
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className={styles.dot} />
                ))}
              </div>
            ) : null}

            {status === 'loading' ? (
              <div className={styles.loadingContainer}>
                <div className={styles.loadingDot} />
                <div className={styles.loadingDot} />
                <div className={styles.loadingDot} />
              </div>
            ) : null}

            {(status === 'notice' || status === 'error') && (
              <div className={styles.textWrap}>
                <div
                  ref={textRef}
                  className={`${styles.text} ${status === 'error' ? styles.error : ''}`}
                >
                  {messageText || (status === 'error' ? '发生错误' : '提示')}
                </div>
              </div>
            )}

            {status === 'speaking' ? (
              <div className={styles.waveBars}>
                {barHeights.map((h, i) => (
                  <div key={i} className={styles.bar} style={{ height: `${h}px` }} />
                ))}
              </div>
            ) : null}
          </div>
          <div className={styles.timer} style={{ display: timerVisible ? 'block' : 'none' }}>
            {timerText}
          </div>
        </div>
      ) : null}
    </div>
  );
}
