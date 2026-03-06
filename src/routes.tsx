import React, { useEffect } from 'react';
import type { ReactElement } from 'react';
import { HashRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import App from './renderer/App';
import VoiceRecognitionHost from './renderer/components/VoiceRecognitionHost';
import Init from './renderer/pages/Init';
import StickyNote from './renderer/pages/StickyNote';
import TrayMenu from './renderer/pages/TrayMenu/index';
import VoiceIndicatorPage from './renderer/pages/VoiceIndicator';
import RewriteOverlayPage from './renderer/pages/RewriteOverlay';
import { getToken, saveToken, type UserInfo } from './utils/auth';
import { getUser, currentCycleApi } from './services/user';
import { requestUserInfoRefresh } from './renderer/utils/refreshUserInfo';

type IpcRendererLike = {
  send?: (channel: string, ...args: unknown[]) => void;
  on?: (channel: string, listener: (...args: unknown[]) => void) => void;
  removeListener?: (channel: string, listener: (...args: unknown[]) => void) => void;
};

function getIpcRenderer(): IpcRendererLike | null {
  try {
    return (
      (
        window as Window & {
          electronAPI?: { ipcRenderer?: IpcRendererLike };
        }
      )?.electronAPI?.ipcRenderer ?? null
    );
  } catch {
    return null;
  }
}

function notifyMainTokenMissing() {
  try {
    const ipc = getIpcRenderer();
    if (ipc?.send) ipc.send('token-expired');
  } catch {
    // ignore
  }
}

function isElectronRuntime() {
  try {
    return !!getIpcRenderer();
  } catch {
    return false;
  }
}

function AppTransitionOverlay() {
  const [visible, setVisible] = React.useState(false);
  const [text, setText] = React.useState('正在切换...');

  useEffect(() => {
    try {
      const ipc = getIpcRenderer();
      if (!ipc?.on) return;

      const handler = (...args: unknown[]) => {
        try {
          const payload = (args?.[1] ?? undefined) as
            | { visible?: unknown; text?: unknown }
            | undefined;
          const v = !!payload?.visible;
          const t = typeof payload?.text === 'string' ? payload?.text : '';
          setVisible(v);
          if (t) setText(t);
          if (!v) setText('正在切换...');
        } catch {
          // ignore
        }
      };

      ipc.on('app-transition', handler);
      return () => {
        try {
          ipc.removeListener?.('app-transition', handler);
        } catch {
          // ignore
        }
      };
    } catch {
      return;
    }
  }, []);

  if (!visible) return null;
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 999999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        // 退出/切窗遮罩：用磨砂浅色，避免整屏黑底突兀
        background: 'rgba(248, 250, 252, 0.75)',
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        userSelect: 'none',
        cursor: 'default',
        pointerEvents: 'auto',
      }}
    >
      <div
        style={{
          width: 240,
          padding: '16px 14px',
          borderRadius: 14,
          background: 'rgba(255, 255, 255, 0.92)',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          boxShadow: '0 12px 36px rgba(15, 23, 42, 0.18)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: 12,
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: 999,
            border: '3px solid rgba(15, 23, 42, 0.12)',
            borderTopColor: 'rgba(15, 23, 42, 0.75)',
            animation: 'appTransitionSpin 0.9s linear infinite',
          }}
        />
        <div
          style={{
            fontSize: 13,
            fontWeight: 600,
            color: '#0f172a',
            textAlign: 'center',
          }}
        >
          {text}
        </div>
        <style>{`@keyframes appTransitionSpin{to{transform:rotate(360deg)}}`}</style>
      </div>
    </div>
  );
}

function RendererRouteReadyReporter() {
  const location = useLocation();
  useEffect(() => {
    try {
      const ipc = (
        window as Window & {
          electronAPI?: { ipcRenderer?: { send?: (channel: string, ...args: unknown[]) => void } };
        }
      )?.electronAPI?.ipcRenderer;
      if (!ipc?.send) return;

      // Ensure this runs after React commit + browser has a chance to paint.
      const sendReady = () => {
        try {
          ipc.send('renderer-route-ready', {
            pathname: location.pathname,
            hash: window.location.hash,
            at: Date.now(),
          });
        } catch {
          // ignore
        }
      };

      requestAnimationFrame(() => requestAnimationFrame(sendReady));
    } catch {
      // ignore
    }
  }, [location.pathname]);

  return null;
}

function RouteScopedVoiceRecognitionHost() {
  const location = useLocation();
  // 引导/login 路由由教程页自行管理语音实例，避免与全局 Host 并发导致重复录制。
  if (
    location.pathname.startsWith('/login') ||
    location.pathname.startsWith('/voice-indicator') ||
    location.pathname.startsWith('/rewrite-overlay')
  )
    return null;
  return <VoiceRecognitionHost />;
}

function RequireToken({ children }: { children: ReactElement }) {
  const location = useLocation();
  const token = getToken();

  useEffect(() => {
    if (!token) {
      if (isElectronRuntime()) {
        // Electron：通知主进程清理登录态/更新托盘状态（窗口不再切换，仅同窗路由跳转）
        notifyMainTokenMissing();
      }
    }
  }, [token]);

  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return children;
}

/**
 * Auth bootstrap:
 * - If renderer has token/userInfo in localStorage but main process store is missing (or main didn't pick it up on startup),
 *   we proactively sync it to main via token-store-* channels.
 * - Then ask main process to re-check auth and switch windows (avoid "home rendered inside login window size").
 */
function AuthBootstrap() {
  useEffect(() => {
    let fetching = false;
    let refreshing = false;
    let lastHandledToken: string | null = null;

    const syncUserInfoToCache = (token: string, userInfo: unknown, syncToMain: boolean) => {
      try {
        // 本地缓存（axios/页面读取用）
        saveToken(token, userInfo as Partial<UserInfo>, { syncToMain });
      } catch {
        // ignore
      }
    };

    try {
      const ipc = (
        window as Window & {
          electronAPI?: { ipcRenderer?: { send?: (channel: string, ...args: unknown[]) => void } };
        }
      )?.electronAPI?.ipcRenderer;
      if (!ipc?.send || !ipc?.on) return;

      const handleTokenReady = async (token: string, userInfoFromMain?: unknown) => {
        const normalizedToken = String(token || '').trim();
        if (!normalizedToken) return;

        // 去重策略：
        // - 同一个 token 且主进程没有提供 userInfo（undefined）时，如果本地已有可用的 user_info 缓存，就不重复拉取。
        // - 但如果本地 user_info 缺失（例如主进程深链换号时会主动清空 localStorage.user_info），则必须 hydrate 一次，
        //   否则会出现“同样 deep link 再来一次后 userInfo 丢失”的问题。
        const localHasUserInfo = (() => {
          try {
            const s = localStorage.getItem('user_info');
            if (!s || !String(s).trim()) return false;
            // 尝试 parse 一下，避免留下脏数据导致误判
            JSON.parse(String(s));
            return true;
          } catch {
            // parse 失败：当成没有可靠缓存，走一次 hydrate
            return false;
          }
        })();
        const mainProvidedUserInfoField = userInfoFromMain !== undefined; // 包含显式 null
        if (lastHandledToken === normalizedToken && !mainProvidedUserInfoField && localHasUserInfo)
          return;
        lastHandledToken = normalizedToken;

        // 只有在“登录页”才把 auth-changed 当成“登录成功”来跳首页/通知主进程显示窗口。
        // 否则（例如语音识别后刷新积分触发 auth-changed），只更新缓存，避免把主窗口从后台拉到前台。
        const isOnLoginRoute = (() => {
          try {
            const h = String(window.location.hash || '');
            return h.startsWith('#/login');
          } catch {
            return false;
          }
        })();

        // 初始化引导期间（仍在 /login 路由），不要把 auth-changed 当成“登录完成”而自动跳首页。
        const shouldAutoEnterAppFromLogin = (() => {
          try {
            const inInit =
              (window as Window & { __sensetype_init_steps_in_progress__?: unknown })
                .__sensetype_init_steps_in_progress__ === true;
            return isOnLoginRoute && !inInit;
          } catch {
            return isOnLoginRoute;
          }
        })();

        // 1) 确保 token 写入渲染侧缓存（localStorage.Authorization）
        try {
          const existing = localStorage.getItem('Authorization');
          if (!existing || !String(existing).trim()) {
            localStorage.setItem('Authorization', normalizedToken);
          }
        } catch {
          // ignore
        }

        // 2) 若主进程已带 userInfo，直接落缓存 + 进入首页
        if (userInfoFromMain !== undefined && userInfoFromMain !== null) {
          // 重要：这里的 userInfo 来自主进程广播，不能再回写主进程，否则会形成 auth-changed 死循环
          syncUserInfoToCache(normalizedToken, userInfoFromMain, false);
          if (shouldAutoEnterAppFromLogin) {
            try {
              window.location.hash = '#/';
            } catch {
              // ignore
            }
            try {
              ipc.send('login-success');
            } catch {
              // ignore
            }
          }
          return;
        }

        // 3) 主进程没带 userInfo：调用 /api/user/self 获取后写缓存，再进首页
        if (fetching) return;
        fetching = true;
        try {
          const resp = await getUser();
          console.log('getUser', resp);

          if (resp?.success && resp.data) {
            // 同时获取套餐周期信息，合并 plan_level 到 userInfo
            try {
              const cycleResp = await currentCycleApi();
              if (cycleResp?.success && cycleResp.data) {
                resp.data.plan_level = cycleResp.data.plan_level;
              }
            } catch {
              // ignore
            }

            // 这里的 userInfo 来自接口请求：需要同步给主进程（electron-store），方便主进程 IPC 请求注入鉴权/托盘展示等
            syncUserInfoToCache(normalizedToken, resp.data, true);
            if (shouldAutoEnterAppFromLogin) {
              try {
                window.location.hash = '#/';
              } catch {
                // ignore
              }
              try {
                ipc.send('login-success');
              } catch {
                // ignore
              }
            }
          }
        } catch {
          // ignore（拿不到 userInfo 不阻塞进入首页；后续页面再 hydrate 也可兜底）
          if (shouldAutoEnterAppFromLogin) {
            try {
              window.location.hash = '#/';
            } catch {
              // ignore
            }
          }
        } finally {
          fetching = false;
        }
      };

      // 启动时：如果本地已有 token，先同步到主进程并让主进程校验/切窗
      const bootstrapToken = getToken();
      if (bootstrapToken) {
        // App 退出后再次打开：即使已有 user_info，也刷新一次用户信息（积分等）
        try {
          requestUserInfoRefresh({ reason: 'app-start' });
        } catch {
          // ignore
        }
        try {
          ipc.send('token-store-set-token', { token: bootstrapToken });
        } catch {
          // ignore
        }
        try {
          const userInfoStr = localStorage.getItem('user_info');
          if (userInfoStr) {
            const userInfo = JSON.parse(userInfoStr) as unknown;
            ipc.send('token-store-set-user-info', { userInfo });
          }
        } catch {
          // ignore
        }
        try {
          // 启动校验：这里需要主进程在必要时显示主窗口（例如冷启动/恢复会话）
          ipc.send('auth-check-request', { show: true, reason: 'renderer-bootstrap' });
        } catch {
          // ignore
        }
      }

      // Deep link / 跨窗登录：主进程会广播 auth-changed，这里接收后拉取 userInfo 并落缓存
      const onAuthChanged = (
        _event: unknown,
        payload: { token?: unknown; userInfo?: unknown } | undefined,
      ) => {
        try {
          const t = payload?.token;
          if (!t) return;
          // 注意：payload.userInfo 可能是显式的 null（例如 deep link 换号时主进程先清空 userInfo，再触发拉取）。
          // 这里不能用 ?? 把 null 吃掉，否则会被 handleTokenReady 的去重逻辑误判为“无需处理”，导致 user_info 丢失。
          const hasUserInfoField =
            !!payload &&
            typeof payload === 'object' &&
            Object.prototype.hasOwnProperty.call(payload, 'userInfo');
          const userInfoFromMain = hasUserInfoField
            ? (payload as { userInfo?: unknown }).userInfo
            : undefined;
          handleTokenReady(String(t), userInfoFromMain);
        } catch {
          // ignore
        }
      };
      ipc.on('auth-changed', onAuthChanged);

      // Deep link: launch=2 → 主进程会发出 user-refresh-request，这里刷新一次用户信息
      const refreshUserInfoOnce = async () => {
        const token = getToken();
        const tokenAtStart = String(token || '').trim();
        if (!tokenAtStart) return;
        if (refreshing) return;
        refreshing = true;
        try {
          const resp = await getUser();
          if (resp?.success && resp.data) {
            // 同时获取套餐周期信息，合并 plan_level 到 userInfo
            try {
              const cycleResp = await currentCycleApi();
              if (cycleResp?.success && cycleResp.data) {
                resp.data.plan_level = cycleResp.data.plan_level;
              }
            } catch {
              // ignore
            }

            // 防止请求返回晚于“退出登录/换号”导致把旧 token 写回缓存。
            const latestToken = String(getToken() || '').trim();
            if (!latestToken || latestToken !== tokenAtStart) return;

            // userInfo 来自接口请求：需要同步给主进程（electron-store）
            syncUserInfoToCache(tokenAtStart, resp.data, true);
          }
        } catch {
          // ignore
        } finally {
          refreshing = false;
        }
      };

      const onUserRefreshRequest = () => {
        try {
          void refreshUserInfoOnce();
        } catch {
          // ignore
        }
      };
      ipc.on('user-refresh-request', onUserRefreshRequest);

      return () => {
        try {
          ipc.removeListener?.('auth-changed', onAuthChanged);
        } catch {
          // ignore
        }
        try {
          ipc.removeListener?.('user-refresh-request', onUserRefreshRequest);
        } catch {
          // ignore
        }
      };
    } catch {
      // ignore
    }
  }, []);
  return null;
}

export default function Router() {
  return (
    <HashRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <AuthBootstrap />
      <RendererRouteReadyReporter />
      <AppTransitionOverlay />
      <RouteScopedVoiceRecognitionHost />
      <Routes>
        <Route path="/login" element={<Init />} />
        <Route path="/voice-indicator" element={<VoiceIndicatorPage />} />
        <Route path="/rewrite-overlay" element={<RewriteOverlayPage />} />
        <Route path="/sticky-note" element={<StickyNote />} />
        <Route path="/tray-menu" element={<TrayMenu />} />
        <Route
          path="/"
          element={
            <RequireToken>
              <App />
            </RequireToken>
          }
        />
      </Routes>
    </HashRouter>
  );
}
