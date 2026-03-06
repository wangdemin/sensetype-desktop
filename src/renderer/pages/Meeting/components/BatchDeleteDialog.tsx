import pageStyles from '../index.module.scss';
import CloseXIcon from '@/assets/icons/meeting/close-x.svg?react';

export type BatchDeleteDialogProps = {
  count: number;
  onConfirm: () => void;
  onCancel: () => void;
};

export default function BatchDeleteDialog({ count, onConfirm, onCancel }: BatchDeleteDialogProps) {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onCancel();
  };

  return (
    <div className={pageStyles.dialogOverlay} onClick={onCancel} onKeyDown={handleKeyDown}>
      <div className={pageStyles.dialogCard} onClick={(e) => e.stopPropagation()}>
        <button className={pageStyles.dialogClose} onClick={onCancel}>
          <CloseXIcon />
        </button>

        <div className={pageStyles.dialogBody}>
          <div className={pageStyles.dialogContent}>
            <h2 className={pageStyles.dialogTitle}>您确认要删除选中的 {count} 个会议纪要吗？</h2>
            <p className={pageStyles.dialogDesc}>删除后，内容将无法找回。</p>
          </div>

          <div className={pageStyles.dialogActions}>
            <button className={pageStyles.dialogBtnOutline} onClick={onCancel}>
              取消
            </button>
            <button className={pageStyles.dialogBtnDanger} onClick={onConfirm}>
              确定删除
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
