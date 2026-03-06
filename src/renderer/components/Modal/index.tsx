import type { ReactNode } from 'react';
import { useRef } from 'react';
import { createPortal } from 'react-dom';
import styles from './index.module.scss';

export type ModalProps = {
  open: boolean;
  onClose: () => void;
  title?: ReactNode;
  subtitle?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  className?: string;
  /** 是否隐藏右上角关闭按钮（默认显示） */
  hideCloseButton?: boolean;
};

export const Modal = ({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  className,
  hideCloseButton = false,
}: ModalProps) => {
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  if (!open) return null;

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    // 记录鼠标按下时的目标元素
    if (e.target === e.currentTarget) {
      mouseDownTargetRef.current = e.target;
    } else {
      mouseDownTargetRef.current = null;
    }
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    // 只有当鼠标按下和松开都在遮罩层上时，才关闭弹窗
    if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
      onClose();
    }
    // 重置状态
    mouseDownTargetRef.current = null;
  };

  const hasTitle = typeof title === 'string' ? title.trim().length > 0 : Boolean(title);
  const hasHeader = hasTitle || Boolean(subtitle);
  // 无标题、无关闭按钮、无 footer：通常用于“仅内容”弹窗（例如 Notes 编辑）
  // 让 modal 透明空白区域点击穿透到 overlay，避免出现“点到标题区域不关闭”的错觉
  const chromeless = !hasHeader && hideCloseButton && !footer;

  return createPortal(
    <div
      className={styles.overlay}
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
      role="dialog"
      aria-modal="true"
    >
      <div
        className={`${styles.modal} ${className ?? ''}`}
        style={
          chromeless
            ? {
                padding: 0,
                background: 'transparent',
                boxShadow: 'none',
                overflow: 'visible',
                pointerEvents: 'none',
                alignItems: 'center',
              }
            : undefined
        }
      >
        {!hideCloseButton && (
          <button type="button" className={styles.closeButton} onClick={onClose} aria-label="关闭">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" xmlns="">
              <path
                d="M12 4L4 12M4 4L12 12"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </button>
        )}

        {chromeless ? (
          children ? (
            <div className={styles.chromelessBody} style={{ pointerEvents: 'auto' }}>
              {children}
            </div>
          ) : null
        ) : (
          <div className={`${styles.content} ${hideCloseButton ? styles.contentNoClose : ''}`}>
            {hasHeader && (
              <>
                {hasTitle && <h2 className={styles.title}>{title}</h2>}
                {subtitle && <p className={styles.subtitle}>{subtitle}</p>}
              </>
            )}
            {children && (
              <div className={hasHeader ? styles.body : styles.bodyNoHeader}>{children}</div>
            )}
          </div>
        )}

        {footer && (
          <div className={styles.footer} style={chromeless ? { pointerEvents: 'auto' } : undefined}>
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};

export default Modal;
