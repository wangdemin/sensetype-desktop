import styles from './index.module.scss';
import { useHoldToRecordKeyLabel } from '@/renderer/hooks/useHoldToRecordKeyLabel';

const Test = () => {
  const { label, isMac, isWin } = useHoldToRecordKeyLabel();
  const keyLabel = isWin && !isMac ? '右 Alt' : label;

  return (
    <div className={styles.test}>
      <p className={styles.testTitle}>测试区</p>
      <p className={styles.hint}></p>
      <div className={styles.testTextAreaWrapper}>
        <textarea
          className={styles.testTextArea}
          placeholder={`可以在这里测试语音输入（先点击聚焦，按住${keyLabel} 键讲话，松开后即可插入语音文本；也可以同时按下 ${isWin && !isMac ? 'Ctrl' : 'Fn'} + ${isWin && !isMac ? 'Win' : '空格'} 键讲话，再次按下即可停止）`}
        />
      </div>
    </div>
  );
};

export default Test;
