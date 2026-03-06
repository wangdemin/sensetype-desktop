import { useState, useEffect, useRef } from 'react';
import styles from '../index.module.scss';
import CloseXIcon from '@/assets/icons/meeting/close-x.svg?react';

const MAX_TITLE_LENGTH = 50;

export type RenameDialogProps = {
  initialTitle: string;
  onConfirm: (newTitle: string) => void;
  onCancel: () => void;
};

export default function RenameDialog({ initialTitle, onConfirm, onCancel }: RenameDialogProps) {
  const [value, setValue] = useState(initialTitle.slice(0, MAX_TITLE_LENGTH));
  const inputRef = useRef<HTMLInputElement>(null);
  const mouseDownTargetRef = useRef<EventTarget | null>(null);

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') onConfirm(value.trim() || initialTitle);
    if (e.key === 'Escape') onCancel();
  };

  const handleOverlayMouseDown = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      mouseDownTargetRef.current = e.target;
    } else {
      mouseDownTargetRef.current = null;
    }
  };

  const handleOverlayMouseUp = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget && mouseDownTargetRef.current === e.currentTarget) {
      onCancel();
    }
    mouseDownTargetRef.current = null;
  };

  return (
    <div
      className={styles.dialogOverlay}
      onMouseDown={handleOverlayMouseDown}
      onMouseUp={handleOverlayMouseUp}
    >
      <div className={styles.dialogCard}>
        <button className={styles.dialogClose} onClick={onCancel}>
          <CloseXIcon />
        </button>

        <div className={styles.dialogBody}>
          <div className={styles.dialogContent}>
            <h2 className={styles.dialogTitle}>输入名称</h2>
            <div className={styles.renameInputWrap}>
              <input
                ref={inputRef}
                className={styles.dialogInput}
                value={value}
                onChange={(e) => setValue(e.target.value.slice(0, MAX_TITLE_LENGTH))}
                onKeyDown={handleKeyDown}
                placeholder="请输入会议名称"
                maxLength={MAX_TITLE_LENGTH}
              />
              <span className={styles.renameCharCount}>
                {value.length}/{MAX_TITLE_LENGTH}
              </span>
            </div>
          </div>

          <div className={styles.dialogActions}>
            <button className={styles.dialogBtnOutline} onClick={onCancel}>
              取消
            </button>
            <button
              className={styles.dialogBtnDark}
              onClick={() => onConfirm(value.trim() || initialTitle)}
            >
              保存更改
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
