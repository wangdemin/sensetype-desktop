import { useCallback, useEffect, useRef, useState } from 'react';
import styles from './index.module.scss';
import CloseIcon from '@/assets/icons/close.svg?react';
import StepMicIcon from '@/assets/icons/step-mic.svg?react';
import CopyIcon from '@/assets/icons/notes-copy.svg?react';
import RewriteMagicIcon from '@/assets/icons/rewrite-magic.svg?react';
import RewriteLogoIcon from '@/assets/icons/rewrite-logo.svg?react';

type IpcRendererLike = {
  send?: (channel: string, payload?: unknown) => void;
  on?: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void;
};

type ClipboardLike = {
  writeText?: (text: string) => void;
};

type WindowWithElectron = Window & {
  electronAPI?: { ipcRenderer?: IpcRendererLike };
  require?: (moduleName: string) =>
    | {
        ipcRenderer?: IpcRendererLike;
        clipboard?: ClipboardLike;
      }
    | undefined;
};

const DEFAULT_WIDTH = 544;
const DEFAULT_HEIGHT = 420;
const DEFAULT_BOTTOM = 16;
const DEFAULT_PADDING = 16;
const QUESTION_HINT = '语音改写已完成，可在下方继续编辑并复制。';

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), max);
}

function getIpcRenderer(): IpcRendererLike | null {
  const win = window as WindowWithElectron;
  try {
    const injected = win.electronAPI?.ipcRenderer;
    if (injected) return injected;
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

function getClipboard(): ClipboardLike | null {
  const win = window as WindowWithElectron;
  try {
    const req = win.require;
    if (typeof req === 'function') {
      return req('electron')?.clipboard ?? null;
    }
  } catch {
    // ignore
  }
  return null;
}

export default function RewriteOverlayPage() {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const textRef = useRef<HTMLTextAreaElement | null>(null);
  const ipcRef = useRef<IpcRendererLike | null>(null);
  const clipboardRef = useRef<ClipboardLike | null>(null);
  const closeTimerRef = useRef<number | null>(null);
  const resizeReflowTimerRef = useRef<number | null>(null);
  const originalTextRef = useRef('');
  const currentTextRef = useRef('');

  const draggingRef = useRef(false);
  const dragStartXRef = useRef(0);
  const dragStartYRef = useRef(0);
  const startLeftRef = useRef(0);
  const startTopRef = useRef(0);
  const dragWidthRef = useRef(0);
  const dragHeightRef = useRef(0);
  const onDragMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const onDragEndRef = useRef<((e: MouseEvent) => void) | null>(null);

  const resizingRef = useRef(false);
  const resizeDirRef = useRef('se');
  const resizeStartXRef = useRef(0);
  const resizeStartYRef = useRef(0);
  const startWidthRef = useRef(0);
  const startHeightRef = useRef(0);
  const resizeStartLeftRef = useRef(0);
  const resizeStartTopRef = useRef(0);
  const onResizeMoveRef = useRef<((e: MouseEvent) => void) | null>(null);
  const onResizeEndRef = useRef<((e: MouseEvent) => void) | null>(null);

  const [textValue, setTextValue] = useState('');
  const [questionTextValue, setQuestionTextValue] = useState(QUESTION_HINT);

  const sendCardBounds = useCallback(() => {
    try {
      const cardEl = cardRef.current;
      if (!cardEl) return;
      const rect = cardEl.getBoundingClientRect();
      ipcRef.current?.send?.('rewrite-overlay-card-bounds', {
        left: Math.round(rect.left),
        top: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      });
    } catch {
      // ignore
    }
  }, []);

  const resetCardLayout = useCallback((options: { silent?: boolean } = {}) => {
    const cardEl = cardRef.current;
    if (!cardEl) return;
    const { silent = false } = options;
    if (silent) {
      cardEl.style.transition = 'none';
      cardEl.style.opacity = '0';
    }
    const width = Math.min(DEFAULT_WIDTH, Math.max(320, window.innerWidth - 32));
    const height = Math.min(DEFAULT_HEIGHT, Math.max(180, window.innerHeight - 32));
    cardEl.style.width = `${width}px`;
    cardEl.style.height = `${height}px`;
    cardEl.style.left = '50%';
    cardEl.style.bottom = `${DEFAULT_BOTTOM}px`;
    cardEl.style.top = 'auto';
    cardEl.style.transform = 'translateX(-50%)';
    if (silent) {
      requestAnimationFrame(() => {
        if (!cardRef.current) return;
        cardRef.current.style.transition = '';
      });
    }
  }, []);

  const setText = useCallback((text: string) => {
    const t = String(text || '');
    originalTextRef.current = t;
    currentTextRef.current = t;
    setTextValue(t);
  }, []);

  const closeWithFade = useCallback(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;
    cardEl.style.transition = 'opacity 120ms ease-out';
    cardEl.style.opacity = '0';
    if (closeTimerRef.current !== null) {
      window.clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    closeTimerRef.current = window.setTimeout(() => {
      ipcRef.current?.send?.('rewrite-overlay-hide');
      resetCardLayout({ silent: true });
      closeTimerRef.current = null;
    }, 130);
  }, [resetCardLayout]);

  const ensureAbsolutePosition = useCallback(() => {
    const cardEl = cardRef.current;
    if (!cardEl) return;
    const rect = cardEl.getBoundingClientRect();
    cardEl.style.left = `${rect.left}px`;
    cardEl.style.top = `${rect.top}px`;
    cardEl.style.bottom = 'auto';
    cardEl.style.transform = 'none';
  }, []);

  const getBounds = useCallback((width: number, height: number) => {
    const padding = DEFAULT_PADDING;
    const maxX = window.innerWidth - padding - width;
    const maxY = window.innerHeight - padding - height;
    return {
      minX: padding,
      minY: padding,
      maxX: Math.max(padding, maxX),
      maxY: Math.max(padding, maxY),
    };
  }, []);

  const stopDrag = useCallback(() => {
    if (onDragMoveRef.current) {
      window.removeEventListener('mousemove', onDragMoveRef.current);
      onDragMoveRef.current = null;
    }
    if (onDragEndRef.current) {
      window.removeEventListener('mouseup', onDragEndRef.current);
      onDragEndRef.current = null;
    }
    draggingRef.current = false;
  }, []);

  const stopResize = useCallback(() => {
    if (onResizeMoveRef.current) {
      window.removeEventListener('mousemove', onResizeMoveRef.current);
      onResizeMoveRef.current = null;
    }
    if (onResizeEndRef.current) {
      window.removeEventListener('mouseup', onResizeEndRef.current);
      onResizeEndRef.current = null;
    }
    resizingRef.current = false;
  }, []);

  const onCardMouseDown = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const cardEl = cardRef.current;
      const textEl = textRef.current;
      if (!cardEl) return;
      const target = e.target as HTMLElement;
      if (target === textEl || !!target.closest('button') || !!target.closest('[data-dir]')) {
        return;
      }

      draggingRef.current = true;
      ensureAbsolutePosition();
      const rect = cardEl.getBoundingClientRect();
      dragStartXRef.current = e.clientX;
      dragStartYRef.current = e.clientY;
      startLeftRef.current = rect.left;
      startTopRef.current = rect.top;
      dragWidthRef.current = rect.width;
      dragHeightRef.current = rect.height;

      const onDragMove = (event: MouseEvent) => {
        if (!draggingRef.current || !cardRef.current) return;
        const bounds = getBounds(dragWidthRef.current, dragHeightRef.current);
        const nextLeft = clamp(
          startLeftRef.current + (event.clientX - dragStartXRef.current),
          bounds.minX,
          bounds.maxX,
        );
        const nextTop = clamp(
          startTopRef.current + (event.clientY - dragStartYRef.current),
          bounds.minY,
          bounds.maxY,
        );
        cardRef.current.style.left = `${nextLeft}px`;
        cardRef.current.style.top = `${nextTop}px`;
      };

      const onDragEnd = (event: MouseEvent) => {
        if (!draggingRef.current) return;
        stopDrag();
        sendCardBounds();
        try {
          const rectNow = cardRef.current?.getBoundingClientRect();
          if (!rectNow) return;
          const overCard =
            event.clientX >= rectNow.left &&
            event.clientX <= rectNow.right &&
            event.clientY >= rectNow.top &&
            event.clientY <= rectNow.bottom;
          if (!overCard) {
            ipcRef.current?.send?.('rewrite-overlay-mouse', { hovered: false });
          }
        } catch {
          // ignore
        }
      };

      onDragMoveRef.current = onDragMove;
      onDragEndRef.current = onDragEnd;
      window.addEventListener('mousemove', onDragMove);
      window.addEventListener('mouseup', onDragEnd);
    },
    [ensureAbsolutePosition, getBounds, sendCardBounds, stopDrag],
  );

  const onResizeHandleMouseDown = useCallback(
    (dir: string, e: React.MouseEvent<HTMLDivElement>) => {
      const cardEl = cardRef.current;
      if (!cardEl) return;

      resizingRef.current = true;
      resizeDirRef.current = dir;
      ensureAbsolutePosition();
      const rect = cardEl.getBoundingClientRect();
      resizeStartXRef.current = e.clientX;
      resizeStartYRef.current = e.clientY;
      startWidthRef.current = rect.width;
      startHeightRef.current = rect.height;
      resizeStartLeftRef.current = rect.left;
      resizeStartTopRef.current = rect.top;

      const onResizeMove = (event: MouseEvent) => {
        if (!resizingRef.current || !cardRef.current) return;
        const deltaX = event.clientX - resizeStartXRef.current;
        const deltaY = event.clientY - resizeStartYRef.current;
        const minWidth = 320;
        const minHeight = 180;
        const maxWidth = window.innerWidth - 32;
        const maxHeight = window.innerHeight - 32;
        let nextLeft = resizeStartLeftRef.current;
        let nextTop = resizeStartTopRef.current;
        let nextWidth = startWidthRef.current;
        let nextHeight = startHeightRef.current;
        const resizeDir = resizeDirRef.current;

        if (resizeDir.includes('e')) nextWidth = startWidthRef.current + deltaX;
        if (resizeDir.includes('s')) nextHeight = startHeightRef.current + deltaY;
        if (resizeDir.includes('w')) {
          nextWidth = startWidthRef.current - deltaX;
          nextLeft = resizeStartLeftRef.current + deltaX;
        }
        if (resizeDir.includes('n')) {
          nextHeight = startHeightRef.current - deltaY;
          nextTop = resizeStartTopRef.current + deltaY;
        }

        nextWidth = clamp(nextWidth, minWidth, maxWidth);
        nextHeight = clamp(nextHeight, minHeight, maxHeight);

        if (resizeDir.includes('w')) {
          nextLeft = resizeStartLeftRef.current + (startWidthRef.current - nextWidth);
        }
        if (resizeDir.includes('n')) {
          nextTop = resizeStartTopRef.current + (startHeightRef.current - nextHeight);
        }

        const bounds = getBounds(nextWidth, nextHeight);
        nextLeft = clamp(nextLeft, bounds.minX, bounds.maxX);
        nextTop = clamp(nextTop, bounds.minY, bounds.maxY);

        cardRef.current.style.width = `${nextWidth}px`;
        cardRef.current.style.height = `${nextHeight}px`;
        cardRef.current.style.left = `${nextLeft}px`;
        cardRef.current.style.top = `${nextTop}px`;
      };

      const onResizeEnd = (event: MouseEvent) => {
        if (!resizingRef.current) return;
        stopResize();
        sendCardBounds();
        try {
          const rectNow = cardRef.current?.getBoundingClientRect();
          if (!rectNow) return;
          const overCard =
            event.clientX >= rectNow.left &&
            event.clientX <= rectNow.right &&
            event.clientY >= rectNow.top &&
            event.clientY <= rectNow.bottom;
          if (!overCard) {
            ipcRef.current?.send?.('rewrite-overlay-mouse', { hovered: false });
          }
        } catch {
          // ignore
        }
      };

      onResizeMoveRef.current = onResizeMove;
      onResizeEndRef.current = onResizeEnd;
      window.addEventListener('mousemove', onResizeMove);
      window.addEventListener('mouseup', onResizeEnd);
    },
    [ensureAbsolutePosition, getBounds, sendCardBounds, stopResize],
  );

  const onCardMouseEnter = useCallback(() => {
    ipcRef.current?.send?.('rewrite-overlay-mouse', { hovered: true });
  }, []);

  const onCardMouseLeave = useCallback(() => {
    if (!draggingRef.current && !resizingRef.current) {
      ipcRef.current?.send?.('rewrite-overlay-mouse', { hovered: false });
    }
  }, []);

  const onTextMouseDown = useCallback(() => {
    ipcRef.current?.send?.('rewrite-overlay-edit', { editing: true });
  }, []);

  const onTextFocus = useCallback(() => {
    ipcRef.current?.send?.('rewrite-overlay-edit', { editing: true });
  }, []);

  const onTextBlur = useCallback(() => {
    ipcRef.current?.send?.('rewrite-overlay-edit', { editing: false });
  }, []);

  const copyCurrentText = useCallback(() => {
    try {
      clipboardRef.current?.writeText?.(
        String(textRef.current?.value || currentTextRef.current || ''),
      );
    } catch {
      // ignore
    }
  }, []);

  const onQuickCopyClick = useCallback(() => {
    copyCurrentText();
  }, [copyCurrentText]);

  const onCopyClick = useCallback(() => {
    try {
      const edited = String(textRef.current?.value || currentTextRef.current || '');
      if (originalTextRef.current && edited !== originalTextRef.current) {
        ipcRef.current?.send?.('rewrite-overlay-ai-edit', {
          original: originalTextRef.current,
          edited,
        });
      }
    } catch {
      // ignore
    }
    copyCurrentText();
    closeWithFade();
  }, [closeWithFade, copyCurrentText]);

  useEffect(() => {
    ipcRef.current = getIpcRenderer();
    clipboardRef.current = getClipboard();
  }, []);

  useEffect(() => {
    const ipc = ipcRef.current;
    if (!ipc?.on) return;

    const onOverlaySet = (...args: unknown[]) => {
      const payload =
        (args?.[1] as { text?: string; questionText?: string } | undefined) ?? undefined;
      setText(payload?.text || '');
      const nextQuestionText = String(payload?.questionText || '').trim();
      setQuestionTextValue(nextQuestionText || QUESTION_HINT);
      requestAnimationFrame(() => {
        if (cardRef.current) cardRef.current.style.opacity = '1';
        requestAnimationFrame(sendCardBounds);
      });
    };

    ipc.on('rewrite-overlay-set', onOverlaySet);
    return () => {
      try {
        ipc.removeListener?.('rewrite-overlay-set', onOverlaySet);
      } catch {
        // ignore
      }
    };
  }, [sendCardBounds, setText]);

  useEffect(() => {
    const onKeydown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        closeWithFade();
      }
    };

    const onResize = () => {
      if (resizeReflowTimerRef.current !== null) {
        window.clearTimeout(resizeReflowTimerRef.current);
      }
      resizeReflowTimerRef.current = window.setTimeout(() => {
        resizeReflowTimerRef.current = null;
        const cardEl = cardRef.current;
        if (!cardEl) return;
        const rect = cardEl.getBoundingClientRect();
        const bounds = getBounds(rect.width, rect.height);
        const nextLeft = clamp(rect.left, bounds.minX, bounds.maxX);
        const nextTop = clamp(rect.top, bounds.minY, bounds.maxY);
        cardEl.style.left = `${nextLeft}px`;
        cardEl.style.top = `${nextTop}px`;
        sendCardBounds();
      }, 120);
    };

    window.addEventListener('keydown', onKeydown);
    window.addEventListener('resize', onResize);

    return () => {
      window.removeEventListener('keydown', onKeydown);
      window.removeEventListener('resize', onResize);
    };
  }, [closeWithFade, getBounds, sendCardBounds]);

  useEffect(() => {
    resetCardLayout();
    requestAnimationFrame(sendCardBounds);

    return () => {
      stopDrag();
      stopResize();
      if (closeTimerRef.current !== null) {
        window.clearTimeout(closeTimerRef.current);
        closeTimerRef.current = null;
      }
      if (resizeReflowTimerRef.current !== null) {
        window.clearTimeout(resizeReflowTimerRef.current);
        resizeReflowTimerRef.current = null;
      }
    };
  }, [resetCardLayout, sendCardBounds, stopDrag, stopResize]);

  return (
    <div className={styles.wrap}>
      <div
        className={`${styles.card} ${styles.draggable}`}
        ref={cardRef}
        role="dialog"
        aria-label="重写结果"
        onMouseDown={onCardMouseDown}
        onMouseEnter={onCardMouseEnter}
        onMouseLeave={onCardMouseLeave}
      >
        <div className={styles.inner}>
          <div className={styles.topBar}>
            <div className={styles.brand}>
              <RewriteLogoIcon />
            </div>
            <button className={styles.close} aria-label="close" onClick={closeWithFade}>
              <CloseIcon />
            </button>
          </div>

          <div className={styles.content}>
            <div className={styles.questionRow}>
              <div className={styles.questionMain}>
                <StepMicIcon className={styles.micIcon} />
                <p className={styles.questionText}>{questionTextValue}</p>
              </div>
              <button className={styles.copy} aria-label="copy" onClick={onQuickCopyClick}>
                <CopyIcon />
              </button>
            </div>

            <div className={styles.answerCard}>
              <div className={styles.answerHeader}>
                <div className={styles.answerTitle}>
                  <RewriteMagicIcon className={styles.magicIcon} aria-hidden="true" />
                  <span>回答</span>
                </div>
                <button className={styles.copy} aria-label="copy and close" onClick={onCopyClick}>
                  <CopyIcon />
                </button>
              </div>
              <div className={styles.divider} />

              <textarea
                ref={textRef}
                className={styles.body}
                spellCheck={false}
                autoCorrect="off"
                autoCapitalize="off"
                autoComplete="off"
                value={textValue}
                onChange={(e) => {
                  const next = String(e.target.value || '');
                  currentTextRef.current = next;
                  setTextValue(next);
                }}
                onMouseDown={onTextMouseDown}
                onFocus={onTextFocus}
                onBlur={onTextBlur}
              />
            </div>
          </div>
        </div>

        {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as const).map((dir) => (
          <div
            key={dir}
            className={`${styles.resizeHandle} ${styles[`resize${dir.toUpperCase()}`]}`}
            data-dir={dir}
            aria-hidden="true"
            onMouseDown={(e) => onResizeHandleMouseDown(dir, e)}
          />
        ))}
      </div>
    </div>
  );
}
