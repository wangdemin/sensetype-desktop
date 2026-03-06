import styles from './index.module.scss';
import ExpandCollapseIcon from '@/assets/icons/expand-collapse.svg?react';
import SettingsIcon from '@/assets/icons/settings.svg?react';
import AccountIcon from '@/assets/icons/user.svg?react';
import QrCodeIcon from '@/assets/icons/qr-code.svg?react';
import type { PageKey } from '@/renderer/types/navigation';
import { track } from '@/utils/posthog';

/**
 * macOS 自定义标题栏（与红黄绿按钮同行的内容区）
 * 主进程需设置 titleBarStyle: 'hiddenInset'，左侧留出交通灯区域
 */
type MacWindowHeaderProps = {
  sidebarCollapsed: boolean;
  onToggleSidebar: () => void;
  currentPage: PageKey;
  onChange: (page: PageKey) => void;
};

const MacWindowHeader = ({
  sidebarCollapsed,
  onToggleSidebar,
  currentPage,
  onChange,
}: MacWindowHeaderProps) => {
  return (
    <header className={styles.header}>
      <div className={styles.left}>
        <button
          type="button"
          className={styles.collapseToggle}
          onClick={onToggleSidebar}
          aria-label={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
          title={sidebarCollapsed ? '展开侧边栏' : '收起侧边栏'}
        >
          <ExpandCollapseIcon />
        </button>
      </div>

      <div className={styles.right}>
        <div className={styles.qrCodeWrapper}>
          <button
            type="button"
            className={styles.headerAction}
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
        <button
          type="button"
          className={`${styles.headerAction} ${currentPage === 'settings' ? styles.active : ''}`}
          onClick={() => {
            onChange('settings');
            track('sensetype_sidebar_click', { $x_page: 'settings' });
          }}
          aria-label="设置"
          title="设置"
        >
          <SettingsIcon />
        </button>
        <button
          type="button"
          className={`${styles.headerAction} ${currentPage === 'account' ? styles.active : ''}`}
          onClick={() => {
            onChange('account');
            track('sensetype_sidebar_click', { $x_page: 'account' });
          }}
          aria-label="账户"
          title="账户"
        >
          <AccountIcon />
        </button>
      </div>
    </header>
  );
};

export default MacWindowHeader;
