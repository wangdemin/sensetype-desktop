import Menu from './components/Menu';
import Content from './components/Content';
import WindowHeader from './components/WindowHeader';
import MacWindowHeader from './components/MacWindowHeader';
import Modal from './components/Modal';
import { InfoButton } from './components/InfoListCard';
import { useState, useEffect, useCallback } from 'react';
import styles from './App.module.scss';
import type { PageKey } from '@/renderer/types/navigation';
import { useUserStore } from './store/useUserStore';
import { closeUpdateAvailableModal, useUpdateModalStore } from './store/useUpdateModalStore';
import { useCheckinConfigStore } from './store/useCheckinConfigStore';
import { useMeetingStore } from './store/useMeetingSubPageStore';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
import { checkForUpdates } from '@/renderer/utils/checkUpdate';

function App() {
  const [currentPage, setCurrentPage] = useState<PageKey>('home');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [forceUpdateKey, setForceUpdateKey] = useState(0);
  const updateAvailableModalOpen = useUpdateModalStore((s) => s.updateAvailableModalOpen);
  const latestVersion = useUpdateModalStore((s) => s.latestVersion);

  const isMac = window?.sensetype?.isMacOs?.() ?? false;
  const hydrateUser = useUserStore((s) => s.hydrate);
  const fetchCheckinConfig = useCheckinConfigStore((s) => s.fetchConfig);
  const meetingSubPage = useMeetingStore((s) => s.subPage);
  const isMeetingRecordingActive = useMeetingStore((s) => s.isRecordingActive);
  const requestMeetingStopConfirm = useMeetingStore((s) => s.requestStopConfirm);

  const handlePageChange = useCallback(
    (nextPage: PageKey) => {
      if (nextPage === currentPage) return;
      const shouldBlockLeaveMeeting =
        currentPage === 'meeting' && nextPage !== 'meeting' && isMeetingRecordingActive;
      if (shouldBlockLeaveMeeting) {
        requestMeetingStopConfirm?.();
        return;
      }
      setCurrentPage(nextPage);
    },
    [currentPage, isMeetingRecordingActive, requestMeetingStopConfirm],
  );

  const openExternal = (url: string) => {
    try {
      (window as any)?.sensetype?.shellOpenExternal?.(url);
      return;
    } catch {
      // ignore
    }
    try {
      window.open(url, '_blank', 'noopener,noreferrer');
    } catch {
      // ignore
    }
  };

  // 检查更新逻辑
  useEffect(() => {
    const checkUpdate = async () => {
      try {
        await checkForUpdates({
          // 自动检查：遵守 last_notified_update_version 去重
          force: false,
          // 与旧逻辑保持一致：接口失败也弹窗（兜底 0.0.1）
          openOnError: true,
          fallbackVersion: '0.0.1',
          openModal: true,
        });
      } catch (e) {
        console.error('Auto update check failed', e);
      }
    };

    // 可以在应用加载后稍微延迟检查，避免抢占初始化资源
    const timer = setTimeout(checkUpdate, 1000);
    return () => clearTimeout(timer);
  }, []);

  // 提供给主进程的强制重新渲染方法
  useEffect(() => {
    (window as any).__sensetype_force_update__ = () => {
      setForceUpdateKey((prev) => prev + 1);
    };
  }, []);

  // 启动时从 electron-store hydrate 一次用户信息（避免页面频繁同步 IPC）
  useEffect(() => {
    hydrateUser();
  }, [hydrateUser]);

  // 主进程触发页面跳转（例如托盘菜单）
  useEffect(() => {
    const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
    if (!ipcRenderer?.on) return;
    const handler = (_event: unknown, payload: { page?: PageKey }) => {
      const next = payload?.page;
      if (!next) return;
      handlePageChange(next);
    };
    ipcRenderer.on('app-navigate', handler);
    return () => {
      try {
        ipcRenderer.off?.('app-navigate', handler);
      } catch {
        // ignore
      }
    };
  }, [handlePageChange]);

  // 切换到 home 页面时获取签到配置
  useEffect(() => {
    if (currentPage === 'home') {
      void fetchCheckinConfig();
    }
  }, [currentPage, fetchCheckinConfig]);

  return (
    <div key={forceUpdateKey} className={styles.app}>
      {isMac ? (
        <MacWindowHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          currentPage={currentPage}
          onChange={handlePageChange}
        />
      ) : (
        <WindowHeader
          sidebarCollapsed={sidebarCollapsed}
          onToggleSidebar={() => setSidebarCollapsed((v) => !v)}
          isHome={currentPage === 'home'}
        />
      )}
      <div className={styles.body}>
        <Menu currentPage={currentPage} onChange={handlePageChange} collapsed={sidebarCollapsed} />
        <div
          className={styles.contentWrapper}
          style={{
            backgroundColor:
              currentPage === 'home' || (currentPage === 'meeting' && meetingSubPage === 'detail')
                ? '#f8f7f9'
                : currentPage === 'meeting' && meetingSubPage !== 'detail'
                  ? '#fff'
                  : undefined,
          }}
        >
          <Content currentPage={currentPage} />
        </div>
      </div>

      <Modal
        open={updateAvailableModalOpen}
        onClose={closeUpdateAvailableModal}
        title="发现新版本"
        subtitle={
          <>
            SenseAudio AI语音输入法 <strong>{latestVersion}</strong>{' '}
            现已发布。我们优化了核心效果并修复了已知问题，
            <br />
            建议您立即更新以获得更优质的使用体验。
          </>
        }
        footer={
          <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end', width: '100%' }}>
            <InfoButton variant="secondary" onClick={closeUpdateAvailableModal}>
              稍后再说
            </InfoButton>
            <InfoButton
              variant="primary"
              onClick={() => {
                closeUpdateAvailableModal();
                const isWin = (window as any)?.sensetype?.isWindows?.() ?? false;
                const isMac = (window as any)?.sensetype?.isMacOs?.() ?? false;
                const arch = (window as any)?.sensetype?.getArch?.() ?? '';
                let url = `${getWebBaseUrl()}/sense-type?`;
                if (isWin) {
                  url += 'update=win';
                } else if (isMac) {
                  if (arch === 'arm64') {
                    url += 'update=arm64';
                  } else {
                    url += 'update=intel';
                  }
                }
                openExternal(url);
              }}
            >
              立即更新
            </InfoButton>
          </div>
        }
      />
    </div>
  );
}

export default App;
