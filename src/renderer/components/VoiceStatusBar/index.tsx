import styles from './index.module.scss';
import type { VoiceRecognitionStatus } from '@/renderer/hooks/useVoiceRecognition';

const VoiceStatusBar = ({
  status,
  holdKeyText,
}: {
  status: VoiceRecognitionStatus;
  holdKeyText: string;
}) => {
  const voiceStateText = status.recording
    ? '录音中…'
    : status.processing
      ? '处理中…'
      : status.sending
        ? '识别中…'
        : '待命';

  return (
    <div className={styles.voiceStatusBar}>
      {/* <div className={styles.voiceRow}>
        <div className={styles.voiceState}>语音：{voiceStateText}</div>
        <div className={styles.voiceHint}>按住 {holdKeyText} 录音，松开识别</div>
      </div> */}
      {status.error ? <div className={styles.voiceError}>{status.error}</div> : null}
    </div>
  );
};

export default VoiceStatusBar;
