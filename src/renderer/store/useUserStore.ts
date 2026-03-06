import { create } from 'zustand';
import { getUserInfo, type UserInfo } from '@/utils/auth';
import { syncPosthogUser } from '@/renderer/analytics/posthog';

type UserState = {
  userInfo: UserInfo | null;
  hydrated: boolean;
};

type UserActions = {
  hydrate: () => void;
  setUserInfo: (userInfo: UserInfo | null) => void;
  clearUserInfo: () => void;
};

function bindAuthChangedOnce(set: (partial: Partial<UserState>) => void) {
  try {
    const ipcRenderer = (window as any)?.electronAPI?.ipcRenderer;
    if (!ipcRenderer?.on) return;
    if ((window as any).__sensetype_user_store_auth_changed_bound) return;
    (window as any).__sensetype_user_store_auth_changed_bound = true;

    ipcRenderer.on('auth-changed', (_event: any, payload: any) => {
      try {
        set({ userInfo: (payload?.userInfo ?? null) as UserInfo | null, hydrated: true });
      } catch {
        // ignore
      }
    });
  } catch {
    // ignore
  }
}

/**
 * 用户信息内存缓存（Zustand）
 * - 避免页面频繁调用 getUserInfo()（同步 IPC）造成卡顿
 * - 启动时 hydrate 一次；登录/登出时更新
 */
export const useUserStore = create<UserState & UserActions>((set) => ({
  // 启动即从 localStorage 读取一次（AuthBootstrap / saveToken 会写入 user_info）
  userInfo: getUserInfo(),
  hydrated: true,
  // 绑定一次跨窗口登录态更新：主进程会广播 auth-changed
  hydrate: () => {
    bindAuthChangedOnce(set);
    // 兜底：再同步一次本地缓存，确保 UI 立即刷新
    set({ userInfo: getUserInfo(), hydrated: true });
  },
  setUserInfo: (userInfo) => set({ userInfo }),
  clearUserInfo: () => set({ userInfo: null }),
}));

// 模块加载时自动绑定一次，避免页面未调用 hydrate 导致 UI 不更新
try {
  bindAuthChangedOnce((partial) => useUserStore.setState(partial));
} catch {
  // ignore
}

// 用户变化时 identify/reset
try {
  let last: unknown | null = (useUserStore.getState().userInfo ?? null) as unknown;
  // 启动时同步一次
  syncPosthogUser(last);
  useUserStore.subscribe((state) => {
    const next = (state.userInfo ?? null) as unknown;
    if (next === last) return;
    last = next;
    syncPosthogUser(next);
  });
} catch {
  // ignore
}
