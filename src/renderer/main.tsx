import Router from '@/routes';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ErrorBoundary from './components/ErrorBoundary';
import '@/assets/styles/global.scss';
import { initPosthogOnce } from '@/renderer/analytics/posthog';
import { track } from '@/utils/posthog';

// 打包版默认关闭日志（避免 console 输出在某些环境造成卡顿/卡死）
// 注意：构建时也会做 drop_console，这里是运行时兜底。
try {
  if (import.meta.env.PROD) {
    const noop = () => {};
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).log = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).info = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).warn = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).debug = noop;
  }
} catch {
  // ignore
}

async function hydrateTokenFromMainProcess(): Promise<void> {
  try {
    const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
    if (!ipcRenderer) return;

    // 1. 恢复 Token
    let hasToken = false;
    try {
      const existing = localStorage.getItem('Authorization');
      if (existing && String(existing).trim()) {
        hasToken = true;
      }
    } catch {
      // ignore
    }

    if (!hasToken) {
      // 优先用 invoke（非阻塞）；兜底才用 sendSync
      let token: any = null;
      if (typeof ipcRenderer.invoke === 'function') {
        token = await ipcRenderer.invoke('token-store-get-token');
      } else if (typeof ipcRenderer.sendSync === 'function') {
        token = ipcRenderer.sendSync('token-store-get-token');
      }
      if (token && String(token).trim()) {
        try {
          localStorage.setItem('Authorization', String(token).trim());
        } catch {
          // ignore
        }
      }
    }

    // 2. 恢复 UserInfo
    // 解决启动闪烁问题：如果本地没有 user_info，尝试从主进程获取（主进程 electron-store 是持久化的）
    let hasUserInfo = false;
    try {
      const u = localStorage.getItem('user_info');
      // 简单判断是否有内容
      if (u && String(u).trim() && u !== '{}' && u !== 'null') {
        hasUserInfo = true;
      }
    } catch {
      // ignore
    }

    if (!hasUserInfo) {
      let userInfo: any = null;
      if (typeof ipcRenderer.invoke === 'function') {
        userInfo = await ipcRenderer.invoke('token-store-get-user-info');
      } else if (typeof ipcRenderer.sendSync === 'function') {
        userInfo = ipcRenderer.sendSync('token-store-get-user-info');
      }

      if (userInfo) {
        try {
          localStorage.setItem('user_info', JSON.stringify(userInfo));
        } catch {
          // ignore
        }
      }
    }
  } catch {
    // ignore
  }
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('找不到 root 元素！');
} else {
  try {
    // 初始化一次 PostHog
    initPosthogOnce();
    // 主进程转发的埋点（例如系统级悬浮窗内的交互）
    try {
      const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
      if (ipcRenderer?.on) {
        ipcRenderer.on('posthog-track', (_e: any, payload: any) => {
          try {
            const event = String(payload?.event || '');
            if (!event) return;
            const props = (payload?.properties || {}) as Record<string, unknown>;
            // 避免异常超长内容导致性能问题：做一个温和截断
            const clip = (v: unknown, max = 4000) => {
              const s = typeof v === 'string' ? v : '';
              return s.length > max ? `${s.slice(0, max)}…(len=${s.length})` : s;
            };
            if (typeof props.$x_original === 'string') props.$x_original = clip(props.$x_original);
            if (typeof props.$x_edited === 'string') props.$x_edited = clip(props.$x_edited);
            track(event, props);
          } catch {
            //
          }
        });
      }
    } catch {
      // ignore
    }
    const root = createRoot(rootElement);
    hydrateTokenFromMainProcess()
      .catch(() => undefined)
      .finally(() => {
        root.render(
          <StrictMode>
            <ErrorBoundary>
              <Router />
            </ErrorBoundary>
          </StrictMode>,
        );
      });
  } catch (error) {
    console.error('渲染应用时出错:', error);
  }
}
