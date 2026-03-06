import { useEffect, useMemo, useState } from 'react';
import styles from './index.module.scss';
import SettingsIcon from '@/assets/icons/settings-tray.svg?react';
import HomeIcon from '@/assets/icons/home.svg?react';
import NotesIcon from '@/assets/icons/notes.svg?react';
import AboutIcon from '@/assets/icons/about-tray.svg?react';
import { getWebBaseUrl } from '@/renderer/common/webBaseUrl';
import { acquireToken } from '@/services/user';
import { formatPoints } from '@/utils/format';
import { track } from '@/utils/posthog';

type TrayMenuState = {
  version?: string;
  points?: number | string;
};

type TrayMenuAction = 'open-home' | 'open-notes' | 'open-update' | 'open-settings' | 'quit';

function getIpcRenderer(): {
  send?: (channel: string, ...args: any[]) => void;
  on?: (channel: string, listener: (...args: any[]) => void) => void;
  off?: (channel: string, listener: (...args: any[]) => void) => void;
  removeListener?: (channel: string, listener: (...args: any[]) => void) => void;
  invoke?: (channel: string, ...args: any[]) => Promise<any>;
} | null {
  try {
    const fromPreload = (window as any)?.electronAPI?.ipcRenderer;
    if (fromPreload) return fromPreload;
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as any;
    return ipcRenderer ?? null;
  } catch {
    return null;
  }
}

function openExternal(url: string) {
  try {
    const shellOpenExternal = (
      window as unknown as { sensetype?: { shellOpenExternal?: (u: string) => void } }
    )?.sensetype?.shellOpenExternal;
    if (typeof shellOpenExternal === 'function') {
      shellOpenExternal(url);
      return true;
    }
  } catch {
    // ignore
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { shell } = require('electron') as { shell?: { openExternal?: (u: string) => void } };
    if (typeof shell?.openExternal === 'function') {
      shell.openExternal(url);
      return true;
    }
  } catch {
    // ignore
  }
  return false;
}

export default function TrayMenu() {
  const ipc = useMemo(() => getIpcRenderer(), []);
  const [version, setVersion] = useState('');
  const [points, setPoints] = useState<number | string | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    const safeSet = (s: TrayMenuState | null | undefined) => {
      if (!mounted || !s) return;
      if (typeof s.version === 'string') setVersion(s.version);
      if (typeof s.points === 'number' || typeof s.points === 'string') setPoints(s.points);
    };

    // 初次加载拉一次 state
    (async () => {
      try {
        if (typeof ipc?.invoke === 'function') {
          const s = await ipc.invoke('tray-menu-get-state');
          safeSet(s);
        }
      } catch {
        // ignore
      }
    })();

    // 主进程推送 state
    const onState = (_event: unknown, payload: TrayMenuState) => {
      safeSet(payload);
    };
    try {
      ipc?.on?.('tray-menu-state', onState);
    } catch {
      // ignore
    }

    return () => {
      mounted = false;
      try {
        ipc?.off?.('tray-menu-state', onState);
      } catch {
        try {
          ipc?.removeListener?.('tray-menu-state', onState);
        } catch {
          // ignore
        }
      }
    };
  }, [ipc]);

  const sendAction = (action: TrayMenuAction) => {
    try {
      ipc?.send?.('tray-menu-action', { action });
    } catch {
      // ignore
    }
  };

  const hide = () => {
    try {
      ipc?.send?.('tray-menu-hide');
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  const versionText = (version || '').trim();
  const pointsValue = Number(points) || 0;
  const formattedPoints = formatPoints(pointsValue, true);

  function getPlatform(): string {
    const w = window as Window & { sensetype?: { isMacOs?: () => boolean } };
    return w?.sensetype?.isMacOs?.() ? 'MACOS' : 'Windows';
  }

  const openUpgrade = () => {
    (async () => {
      const url = new URL(`${getWebBaseUrl()}/auth-intermediate?`);

      track('sensetype_vip_upgrade_click');

      try {
        const resp = await acquireToken({ platform: 'WEB', product: 'SenseAudio' });
        if (resp.success && resp.data?.token) {
          const baseTargetWithQuery = '/workspace/vip-pay?product=SenseType';
          url.searchParams.set('target', baseTargetWithQuery);
          url.searchParams.set('platform', getPlatform());
          url.searchParams.set('product', 'SenseType');
          url.searchParams.set('token', String(resp.data.token));
        }
        console.log(url.toString());
        openExternal(url.toString());
      } catch {
        try {
          openExternal(url.toString());
        } catch {
          // ignore
        }
      }
    })();
  };

  return (
    <div className={styles.page}>
      <div className={styles.card} role="application" aria-label="Tray menu">
        {/* 积分余额（置顶） */}
        <div className={styles.notice} role="note" aria-label="积分余额">
          <div className={styles.noticeLeft}>
            <div className={styles.noticeTitle}>积分余额</div>
            <div className={styles.noticeText}>
              <span className={styles.noticeValueText}>{formattedPoints.value}</span>
              {formattedPoints.unit ? (
                <span className={styles.noticeValueUnit}>{formattedPoints.unit}</span>
              ) : null}
            </div>
          </div>
          <button className={styles.noticeBtn} type="button" onClick={openUpgrade}>
            升级套餐
          </button>
        </div>

        {/* 第二栏：快捷按钮 */}
        <div className={styles.btnRow}>
          <div
            className={styles.tile}
            role="button"
            tabIndex={0}
            onClick={() => sendAction('open-home')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                sendAction('open-home');
              }
            }}
          >
            <div className={styles.tileTop}>
              <HomeIcon className={styles.tileIcon as any} />
              <div className={styles.tileTitle}>打开主页面</div>
            </div>
          </div>

          <div
            className={styles.tile}
            role="button"
            tabIndex={0}
            onClick={() => sendAction('open-notes')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                sendAction('open-notes');
              }
            }}
          >
            <div className={styles.tileTop}>
              <NotesIcon className={styles.tileIcon as any} />
              <div className={styles.tileTitle}>笔记</div>
            </div>
          </div>

          <div
            className={styles.tile}
            role="button"
            tabIndex={0}
            onClick={() => sendAction('open-settings')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                sendAction('open-settings');
              }
            }}
          >
            <div className={styles.tileTop}>
              <SettingsIcon className={styles.tileIcon as any} />
              <div className={styles.tileTitle}>设置</div>
            </div>
          </div>

          <div
            className={styles.tile}
            role="button"
            tabIndex={0}
            onClick={() => sendAction('open-update')}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                sendAction('open-update');
              }
            }}
          >
            <div className={styles.tileTop}>
              <AboutIcon className={styles.tileIcon as any} />
              <div className={styles.tileTitle}>检查更新</div>
            </div>
          </div>
        </div>

        <div className={styles.divider} />

        {/* 第三栏：页尾 版本 + 退出 */}
        <div className={styles.footer}>
          <div
            className={styles.version}
            title={versionText ? `版本：v${versionText}` : '版本：v—'}
          >
            {versionText ? `版本：v${versionText}` : '版本：v—'}
          </div>
          <button className={styles.quitBtn} onClick={() => sendAction('quit')}>
            退出
          </button>
        </div>
      </div>
    </div>
  );
}
