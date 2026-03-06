import { useEffect, useId, useRef } from 'react';
import styles from './index.module.scss';

type ConfirmDialogProps = {
  open: boolean;
  title: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  confirmLoading?: boolean;
  danger?: boolean;
  primary?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

const ConfirmDialog = ({
  open,
  title,
  description,
  confirmText = '确定',
  cancelText = '取消',
  confirmLoading = false,
  danger = false,
  primary = true,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) => {
  const titleId = useId();
  const descId = useId();
  const confirmRef = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (!open) return;
    // 打开时把焦点放在“确定”按钮上，键盘操作更友好
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
        aria-describedby={description ? descId : undefined}
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

        <div className={styles.content}>
          <div id={titleId} className={styles.title}>
            {title}
          </div>
          {description ? (
            <div id={descId} className={styles.desc}>
              {description}
            </div>
          ) : null}
        </div>

        <div className={styles.actions}>
          <button type="button" className={styles.cancelBtn} onClick={onCancel} disabled={confirmLoading}>
            {cancelText}
          </button>
          <button
            ref={confirmRef}
            type="button"
            className={`${styles.confirmBtn} ${danger ? styles.confirmDanger : ''} ${
              !danger && primary ? styles.confirmPrimary : ''
            }`}
            onClick={onConfirm}
            disabled={confirmLoading}
          >
            {confirmLoading ? <span className={styles.spinner} aria-hidden="true" /> : null}
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
