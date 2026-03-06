import posthog from 'posthog-js';
import config from '@/config';
import pkg from '../../../package.json';

declare global {
  interface Window {
    __sensetype_posthog_inited?: boolean;
  }
}

function getCfg(): { key: string; host?: string } | null {
  try {
    const key = String((config as { posthogKey?: unknown })?.posthogKey || '').trim();
    if (!key) return null;
    const host = String((config as { posthogHost?: unknown })?.posthogHost || '').trim();
    return { key, host: host || undefined };
  } catch {
    return null;
  }
}

/**
 * PostHog 初始化
 * - 启动时 init 一次
 * - 登录态变化时 identify/reset
 */
export function initPosthogOnce(): void {
  try {
    if (window.__sensetype_posthog_inited) return;
    window.__sensetype_posthog_inited = true;

    const cfg = getCfg();
    if (!cfg) return;

    posthog.init(cfg.key, {
      api_host: cfg.host,
      // Electron 桌面端：默认关闭 autocapture（更安全、也更省性能）
      autocapture: false,
      capture_pageview: false,
      capture_pageleave: false,
    });
  } catch {
    // ignore
  }
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === 'object' ? (v as Record<string, unknown>) : null;
}

export function syncPosthogUser(userInfo: unknown | null): void {
  try {
    const cfg = getCfg();
    if (!cfg) return;
    initPosthogOnce();

    const u = asRecord(userInfo);
    if (u) {
      const id = u.id ?? u.userId ?? u.uid ?? u.phone ?? undefined;
      if (id != null && String(id).trim()) {
        posthog.identify(String(id), {
          email: u.email,
          name: u.username,
          phone: u.phone,
          $x_os_version: String(pkg.version || '').trim(),
          user_id: String(id),
        });
      }
    } else {
      posthog.reset();
    }
  } catch {
    // ignore
  }
}
