import type React from 'react';
import styles from './index.module.scss';
import MinimizeIcon from '@/assets/icons/minimize.svg?react';
import CloseIcon from '@/assets/icons/close.svg?react';

type RequireFn = (id: string) => unknown;
type ElectronWindowLike = {
  minimize: () => void;
  close: () => void;
};
type ElectronRemoteLike = {
  getCurrentWindow?: () => ElectronWindowLike;
};

function getCurrentWindow() {
  const req = (window as unknown as { require?: RequireFn }).require;
  if (!req) return null;
  try {
    const remote = req('@electron/remote') as ElectronRemoteLike;
    return remote.getCurrentWindow?.() ?? null;
  } catch {
    return null;
  }
}

type InitHeaderProps = {
  children?: React.ReactNode;
};

const InitHeader = ({ children }: InitHeaderProps) => {
  const onMinimize = () => getCurrentWindow()?.minimize();
  const onClose = () => {
    const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
    if (ipcRenderer?.send) {
      ipcRenderer.send('app-quit');
      return;
    }
    getCurrentWindow()?.close();
  };

  return (
    <header className={styles.header}>
      {/* 左侧占位，与右侧按钮对称 */}
      <div className={styles.left} />
      {/* 居中区域：放置步骤条等内容 */}
      <div className={styles.center}>{children}</div>
      <div className={styles.right}>
        <button className={styles.btn} type="button" onClick={onMinimize} aria-label="最小化">
          <MinimizeIcon className={styles.icon} />
        </button>
        <button
          className={`${styles.btn} ${styles.close}`}
          type="button"
          onClick={onClose}
          aria-label="关闭"
        >
          <CloseIcon width={19} height={19} />
        </button>
      </div>
    </header>
  );
};

export default InitHeader;
