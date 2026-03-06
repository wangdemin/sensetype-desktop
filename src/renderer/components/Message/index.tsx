import React from 'react';
import { createRoot, Root } from 'react-dom/client';
import styles from './index.module.scss';
import MessageErrorIcon from '@/assets/icons/message/message-error.svg?react';
import MessageInfoIcon from '@/assets/icons/message/message-info.svg?react';
import MessageSuccessIcon from '@/assets/icons/message/message-success.svg?react';
import MessageWarningIcon from '@/assets/icons/message/message-warning.svg?react';

type MessageType = 'error' | 'info' | 'success' | 'warning';

type MessageOptions = {
  /** 展示时长（ms） */
  durationMs?: number;
};

const CONTAINER_ID = '__sensetype_global_message__';

/** 类型 → 图标组件映射 */
const ICON_MAP: Record<MessageType, React.FC<React.SVGProps<SVGSVGElement>>> = {
  error: MessageErrorIcon,
  success: MessageSuccessIcon,
  warning: MessageWarningIcon,
  info: MessageInfoIcon,
};

/** 类型 → 背景渐变 */
const BG_MAP: Record<MessageType, string> = {
  error: 'linear-gradient(97.38deg, #FFE4DF -9.95%, #FAFAFA 66.53%)',
  success: 'linear-gradient(97.38deg, #DFFFDC -9.95%, #FAFAFA 66.53%)',
  info: 'linear-gradient(97.38deg, #E3DCF8 -9.95%, #FAFAFA 66.53%)',
  warning: 'linear-gradient(97.38deg, #FFF4C8 -9.95%, #FAFAFA 66.53%)',
};

function ensureContainer(): HTMLElement | null {
  try {
    let container = document.getElementById(CONTAINER_ID);
    if (!container) {
      container = document.createElement('div');
      container.id = CONTAINER_ID;
      container.className = styles.container;
      document.body.appendChild(container);
    }
    return container;
  } catch {
    return null;
  }
}

/** Toast 内部 React 内容 */
function ToastContent({ type, msg }: { type: MessageType; msg: string }) {
  const Icon = ICON_MAP[type];
  return (
    <>
      <Icon />
      <span>{msg}</span>
    </>
  );
}

function showToast(msg: string, type: MessageType, options?: MessageOptions) {
  const durationMs = typeof options?.durationMs === 'number' ? options.durationMs : 3000;
  const container = ensureContainer();
  if (!container) return;

  // 控制堆叠数量，避免无限增长
  try {
    while (container.childElementCount >= 3) {
      container.firstElementChild?.remove();
    }
  } catch {
    // ignore
  }

  // ── Toast 容器（DOM 元素，用于控制动画） ──
  const toast = document.createElement('div');
  toast.setAttribute('role', type === 'error' ? 'alert' : 'status');
  toast.setAttribute('aria-live', type === 'error' ? 'assertive' : 'polite');
  toast.className = styles.toast;
  toast.style.setProperty('--toast-bg', BG_MAP[type]);

  container.appendChild(toast);

  // ── React 渲染 ──
  let root: Root | null = createRoot(toast);
  let dismissed = false;

  const dismiss = () => {
    if (dismissed) return;
    dismissed = true;
    toast.classList.remove(styles.visible);
    window.setTimeout(() => {
      try {
        root?.unmount();
        root = null;
        toast.remove();
      } catch {
        // ignore
      }
    }, 200);
  };

  root.render(<ToastContent type={type} msg={msg} />);

  // ── 动画 ──
  requestAnimationFrame(() => {
    toast.classList.add(styles.visible);
  });

  window.setTimeout(dismiss, durationMs);
}

function trySystemNotification(msg: string) {
  try {
    const fn = (window as unknown as { sensetype?: { showNotification?: (s: string) => void } })
      ?.sensetype?.showNotification;
    if (typeof fn === 'function') {
      fn(msg);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

function show(messageText: string, type: MessageType, options?: MessageOptions) {
  showToast(messageText, type, options);
  trySystemNotification(messageText);
}

export const message = {
  error: (text: string, options?: MessageOptions) => show(text, 'error', options),
  success: (text: string, options?: MessageOptions) => show(text, 'success', options),
  warning: (text: string, options?: MessageOptions) => show(text, 'warning', options),
  info: (text: string, options?: MessageOptions) => show(text, 'info', options),
};
