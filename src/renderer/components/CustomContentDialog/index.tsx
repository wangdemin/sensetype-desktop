import { useEffect, useId, useRef, type ReactNode } from 'react';
import styles from './index.module.scss';

type CustomContentDialogProps = {
  open: boolean;
  title: string;
  children?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  confirmLoading?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const CustomContentDialog = ({
  open,
  title,
  children,
  confirmText = '确定',
  cancelText = '取消',
  confirmLoading = false,
  onConfirm,
  onCancel,
}: CustomContentDialogProps) => {
  const titleId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    confirmRef.current?.focus();
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCancel();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className={styles.overlay}
      role="presentation"
      onMouseDown={confirmLoading ? undefined : onCancel}
    >
      <div
        className={styles.dialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          type="button"
          className={styles.closeButton}
          onClick={onCancel}
          aria-label="关闭"
          disabled={confirmLoading}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M12 4L4 12M4 4L12 12"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className={styles.main}>
          <h2 id={titleId} className={styles.title}>
            {title}
          </h2>
          {children ? <div className={styles.body}>{children}</div> : null}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={confirmLoading}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={styles.confirmBtn}
            onClick={onConfirm}
            disabled={confirmLoading}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default CustomContentDialog;
