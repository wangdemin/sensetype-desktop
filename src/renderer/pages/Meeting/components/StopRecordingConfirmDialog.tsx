import pageStyles from '../index.module.scss';
import CloseXIcon from '@/assets/icons/meeting/close-x.svg?react';

export type StopRecordingConfirmDialogProps = {
  onConfirm: () => void;
  onCancel: () => void;
  isStopping?: boolean;
};

export default function StopRecordingConfirmDialog({
  onConfirm,
  onCancel,
  isStopping,
}: StopRecordingConfirmDialogProps) {
  return (
    <div className={pageStyles.dialogOverlay} onClick={isStopping ? undefined : onCancel}>
      <div className={pageStyles.dialogCard} onClick={(e) => e.stopPropagation()}>
        <button className={pageStyles.dialogClose} onClick={onCancel} disabled={isStopping}>
          <CloseXIcon />
        </button>

        <div className={pageStyles.dialogBody}>
          <div className={pageStyles.dialogContent}>
            <h2 className={pageStyles.dialogTitle}>确认结束当前录制吗？</h2>
            <p className={pageStyles.dialogDesc}>结束后会停止录制并返回会议纪要列表</p>
          </div>

          <div className={pageStyles.dialogActions}>
            <button
              className={pageStyles.dialogBtnOutline}
              onClick={onCancel}
              disabled={isStopping}
            >
              取消
            </button>
            <button className={pageStyles.dialogBtnDark} onClick={onConfirm} disabled={isStopping}>
              {isStopping ? '结束中…' : '确定结束'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
