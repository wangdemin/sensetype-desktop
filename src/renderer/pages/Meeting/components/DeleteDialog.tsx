import styles from '../index.module.scss';
import CloseXIcon from '@/assets/icons/meeting/close-x.svg?react';

export type DeleteDialogProps = {
  onConfirm: () => void;
  onCancel: () => void;
};

export default function DeleteDialog({ onConfirm, onCancel }: DeleteDialogProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className={styles.dialogOverlay} onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className={styles.dialogCard} onClick={(e) => e.stopPropagation()}>
        <button className={styles.dialogClose} onClick={onCancel}>
          <CloseXIcon />
        </button>

        <div className={styles.dialogBody}>
          <div className={styles.dialogContent}>
            <h2 className={styles.dialogTitle}>您确认要删除该会议纪要吗？</h2>
            <p className={styles.dialogDesc}>删除后，内容将无法找回。</p>
          </div>

          <div className={styles.dialogActions}>
            <button className={styles.dialogBtnOutline} onClick={onCancel}>
              取消
            </button>
            <button className={styles.dialogBtnDanger} onClick={onConfirm}>
              确定删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
