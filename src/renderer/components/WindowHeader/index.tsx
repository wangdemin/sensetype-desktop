import styles from './index.module.scss';
import MinimizeIcon from '@/assets/icons/minimize.svg?react';
import MaximizeIcon from '@/assets/icons/maximize.svg?react';
import ReturnMaximizeIcon from '@/assets/icons/return-maximize.svg?react';
import CloseIcon from '@/assets/icons/close.svg?react';
import { useEffect, useState } from 'react';
import ExpandCollapseIcon from '@/assets/icons/expand-collapse.svg?react';
import QrCodeIcon from '@/assets/icons/qr-code.svg?react';

type RequireFn = (id: string) => unknown;
type ElectronWindowLike = {
  minimize: () => void;
  maximize: () => void;
  unmaximize: () => void;
  isMaximized: () => boolean;
  close: () => void;
  on?: (event: 'maximize' | 'unmaximize', listener: () => void) => void;
  off?: (event: 'maximize' | 'unmaximize', listener: () => void) => void;
};
type ElectronRemoteLike = {
  getCurrentWindow?: () => ElectronWindowLike;
};

function getCurrentWindow() {
  // nodeIntegration=true 且已 enable(remote)；用 window.require 避免被 Vite 解析打包
  const req = (window as unknown as { require?: RequireFn }).require;
  if (!req) return null;
  try {
    const remote = req('@electron/remote') as ElectronRemoteLike;
    return remote.getCurrentWindow?.() ?? null;
  } catch {
    return null;
  }
}

type WindowHeaderProps = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  isHome?: boolean;
};

const WindowHeader = ({ sidebarCollapsed, onToggleSidebar, isHome }: WindowHeaderProps) => {
  const [isMaximized, setIsMaximized] = useState(false);

  useEffect(() => {
    const win = getCurrentWindow();
    if (!win) return;

    setIsMaximized(win.isMaximized());

    const onMax = () => setIsMaximized(true);
    const onUnmax = () => setIsMaximized(false);

    win.on?.('maximize', onMax);
    win.on?.('unmaximize', onUnmax);

    return () => {
      win.off?.('maximize', onMax);
      win.off?.('unmaximize', onUnmax);
    };
  }, []);

  const onMinimize = () => getCurrentWindow()?.minimize();
  const onToggleMaximize = () => {
    const win = getCurrentWindow();
    if (!win) return;
    if (win.isMaximized()) win.unmaximize();
    else win.maximize();
  };
  const onClose = () => getCurrentWindow()?.close();

  return (
    <header className={`${styles.header} ${isHome ? styles.isHome : ''}`}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.expandCollapseBtn}
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <ExpandCollapseIcon />
        </button>
        <div className={styles.qrCodeWrapper}>
          <button
            type="button"
            className={styles.qrCodeBtn}
            aria-label="官方交流群"
            title="官方交流群"
          >
            <QrCodeIcon />
          </button>
          <div className={styles.qrCodePopup}>
            <img
              src={'https://static.senseaudio.cn/sensetype/communication-group-qr-code.png'}
              alt="SenseAudio-官方交流群"
              className={styles.qrCodeImage}
            />
            <p className={styles.qrCodeTitle}>SenseAudio-官方交流群</p>
            <div className={styles.qrCodeDivider} />
            <p className={styles.qrCodeHint}>扫码加入</p>
          </div>
        </div>
      </div>
      <div className={styles.right}>
        <button className={styles.btn} type="button" onClick={onMinimize} aria-label="最小化">
          <MinimizeIcon />
        </button>
        <button
          className={styles.btn}
          type="button"
          onClick={onToggleMaximize}
          aria-label="最大化/还原"
        >
          {isMaximized ? <ReturnMaximizeIcon /> : <MaximizeIcon />}
        </button>
        <button
          className={`${styles.btn} ${styles.close}`}
          type="button"
          onClick={onClose}
          aria-label="关闭"
        >
          <CloseIcon />
        </button>
      </div>
    </header>
  );
};

export default WindowHeader;
