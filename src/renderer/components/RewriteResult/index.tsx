import styles from './index.module.scss';

export type RewriteResultProps = {
  text: string;
  onClose: () => void;
  onCopy: () => void;
};

export default function RewriteResult(props: RewriteResultProps) {
  const { text, onClose, onCopy } = props;

  return (
    <div className={styles.overlay} role="dialog" aria-label="重写结果">
      <div className={styles.card}>
        <div className={styles.titleRow}>
          <div className={styles.title}>重写结果（已自动复制到剪贴板）</div>
          <button className={styles.close} onClick={onClose} aria-label="close">
            ×
          </button>
        </div>

        <div className={styles.body}>{text}</div>

        <div className={styles.footer}>
          <button className={styles.button} onClick={onCopy}>
            <span>复制并关闭</span>
          </button>
        </div>

        <div className={styles.hint}>
          提示：先在浏览器/文档里框选文本，再长按 Option/Alt 说“怎么改”。
        </div>
      </div>
    </div>
  );
}
