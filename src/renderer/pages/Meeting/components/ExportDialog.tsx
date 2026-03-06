import styles from './ExportDialog.module.scss';

type AudioFormat = 'MP3';
type TranscriptFormat = 'DOCX' | 'TXT';
type SummaryFormat = 'JPEG' | 'PNG';

type ExportDialogProps = {
  visible: boolean;
  isExporting: boolean;
  audioFormat: AudioFormat | null;
  transcriptFormat: TranscriptFormat | null;
  summaryFormat: SummaryFormat | null;
  audioOptions: readonly AudioFormat[];
  transcriptOptions: readonly TranscriptFormat[];
  summaryOptions: readonly SummaryFormat[];
  onClose: () => void;
  onSetAudioFormat: (format: AudioFormat) => void;
  onSetTranscriptFormat: (format: TranscriptFormat) => void;
  onSetSummaryFormat: (format: SummaryFormat) => void;
  onConfirm: () => void;
};

export default function ExportDialog({
  visible,
  isExporting,
  audioFormat,
  transcriptFormat,
  summaryFormat,
  audioOptions,
  transcriptOptions,
  summaryOptions,
  onClose,
  onSetAudioFormat,
  onSetTranscriptFormat,
  onSetSummaryFormat,
  onConfirm,
}: ExportDialogProps) {
  if (!visible) return null;

  return (
    <div className={styles.dialogOverlay} onClick={onClose}>
      <div className={styles.dialogCard} onClick={(e) => e.stopPropagation()}>
        <button className={styles.dialogClose} onClick={onClose} aria-label="关闭导出弹窗">
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
            <path
              d="M5 5L11 11M11 5L5 11"
              stroke="#141414"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>

        <div className={styles.dialogBody}>
          <div className={styles.dialogContent}>
            <h3 className={styles.dialogTitle}>导出</h3>
            <div className={styles.exportSections}>
              <div className={styles.exportSection}>
                <p className={styles.exportLabel}>导出音频</p>
                <div className={styles.exportOptions}>
                  {audioOptions.map((option) => (
                    <button
                      key={option}
                      className={`${styles.exportOption} ${audioFormat === option ? styles.exportOptionActive : ''}`}
                      onClick={() => onSetAudioFormat(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.exportSection}>
                <p className={styles.exportLabel}>导出文字记录</p>
                <div className={styles.exportOptions}>
                  {transcriptOptions.map((option) => (
                    <button
                      key={option}
                      className={`${styles.exportOption} ${transcriptFormat === option ? styles.exportOptionActive : ''}`}
                      onClick={() => onSetTranscriptFormat(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <div className={styles.exportSection}>
                <p className={styles.exportLabel}>导出会议总结</p>
                <div className={styles.exportOptions}>
                  {summaryOptions.map((option) => (
                    <button
                      key={option}
                      className={`${styles.exportOption} ${summaryFormat === option ? styles.exportOptionActive : ''}`}
                      onClick={() => onSetSummaryFormat(option)}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </div>

          <div className={styles.dialogActions}>
            <button className={styles.dialogBtnOutline} onClick={onClose}>
              取消
            </button>
            <button className={styles.dialogBtnDark} onClick={onConfirm} disabled={isExporting}>
              {isExporting ? '导出中…' : '确认导出'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
