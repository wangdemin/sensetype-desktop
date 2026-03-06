import { getUser, currentCycleApi } from '@/services/user';
import { getToken, saveToken } from '@/utils/auth';
import { useUserStore } from '@/renderer/store/useUserStore';

/**
 * 触发一次“刷新用户信息”（主要用于刷新积分）。
 *
 * 设计目标：
 * - 语音识别/重写结束后会高频触发：这里做节流 + 合并，避免接口风暴
 * - 以 localStorage 为主缓存，同时同步到主进程（electron-store），让托盘/主进程逻辑也能拿到最新积分
 * - 尽量让 UI 立即更新（直接更新 zustand store + 触发主进程 auth-changed 广播）
 */

let inFlight: Promise<void> | null = null;
let pending = false;
let lastStartedAt = 0;
let scheduledTimer: ReturnType<typeof setTimeout> | null = null;

async function doRefreshUserInfo(): Promise<void> {
  const token = getToken();
  const tokenAtStart = String(token || '').trim();
  if (!tokenAtStart) return;

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

      // 关键竞态保护：
      // 若请求期间用户已退出登录/切换账号，token 会变为空或变化，
      // 此时不能再把旧 token + userInfo 写回，否则会把路由“拉回已登录态”。
      const latestToken = String(getToken() || '').trim();
      if (!latestToken || latestToken !== tokenAtStart) return;

      // 1) 写入本地缓存 + 通知主进程同步（electron-store），主进程会 broadcast auth-changed
      saveToken(tokenAtStart, resp.data as any, { syncToMain: true });
      // 2) 本地 UI 立即更新（不依赖主进程回传）
      try {
        useUserStore.getState().setUserInfo(resp.data as any);
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
}

export type UserInfoRefreshReason =
  | 'app-start'
  | 'asr-empty'
  | 'asr-segment-done'
  | 'asr-segment-merged-done'
  | 'asr-stream-done'
  | 'asr-stream-failed'
  | 'rewrite-done'
  | 'checkin-done';

export function requestUserInfoRefresh(options?: {
  reason?: UserInfoRefreshReason | string;
  throttleMs?: number;
}): void {
  const throttleMs = typeof options?.throttleMs === 'number' ? options!.throttleMs : 1200;
  const now = Date.now();

  // 正在刷新：标记一个 pending，等结束后合并再跑一次
  if (inFlight) {
    pending = true;
    return;
  }

  const elapsed = now - lastStartedAt;
  if (elapsed < throttleMs) {
    // 节流窗口内：合并到一次定时刷新
    pending = true;
    const dueIn = Math.max(0, throttleMs - elapsed);
    if (scheduledTimer) return;
    scheduledTimer = setTimeout(() => {
      scheduledTimer = null;
      if (!pending) return;
      pending = false;
      requestUserInfoRefresh({ reason: options?.reason, throttleMs: 0 });
    }, dueIn);
    return;
  }

  lastStartedAt = now;
  inFlight = (async () => {
    try {
      await doRefreshUserInfo();
    } finally {
      inFlight = null;
      // 如果期间又有人请求，合并再跑一次（再走一轮节流判断）
      if (pending) {
        pending = false;
        requestUserInfoRefresh({ reason: options?.reason, throttleMs });
      }
    }
  })();
}
