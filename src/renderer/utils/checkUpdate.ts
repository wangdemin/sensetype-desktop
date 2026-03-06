import pkg from '../../../package.json';
import { latestVersionApi } from '@/services/user';
import { openUpdateAvailableModal } from '@/renderer/store/useUpdateModalStore';

const LAST_NOTIFIED_VERSION_KEY = 'last_notified_update_version';

export type CheckUpdateResult =
  | { status: 'latest'; currentVersion: string; latestVersion: string }
  | { status: 'update'; currentVersion: string; latestVersion: string }
  | { status: 'skip'; currentVersion: string; latestVersion: string }
  | { status: 'error'; currentVersion: string; message?: string };

type CheckUpdateOptions = {
  /** 手动点击“检查更新”时一般设为 true，忽略 last_notified_update_version 去重 */
  force?: boolean;
  /** 是否自动弹出全局“发现新版本”弹窗 */
  openModal?: boolean;
  /** 接口失败时是否也弹窗（与旧逻辑保持兼容） */
  openOnError?: boolean;
  /** openOnError=true 时使用的兜底版本号 */
  fallbackVersion?: string;
};

function getCurrentVersion(): string {
  return (pkg as { version?: string }).version ?? '0.0.0';
}

function markNotified(version: string) {
  try {
    localStorage.setItem(LAST_NOTIFIED_VERSION_KEY, version);
  } catch {
    // ignore
  }
}

function getLastNotified(): string {
  try {
    return localStorage.getItem(LAST_NOTIFIED_VERSION_KEY) ?? '';
  } catch {
    return '';
  }
}

/**
 * 全局检查更新：
 * - 统一 latestVersionApi 调用与版本对比
 * - 统一 last_notified_update_version 去重
 * - 可选：直接打开全局“发现新版本”弹窗（App.tsx 内渲染）
 */
export async function checkForUpdates(options?: CheckUpdateOptions): Promise<CheckUpdateResult> {
  const currentVersion = getCurrentVersion();
  const force = options?.force ?? false;
  const openModal = options?.openModal ?? true;
  const openOnError = options?.openOnError ?? false;
  const fallbackVersion = options?.fallbackVersion ?? '0.0.1';

  try {
    const res = await latestVersionApi({ only_ver: true });
    const parsed = res as { success?: unknown; data?: { version?: unknown } } | null | undefined;
    const latestVersion =
      parsed?.success === true && typeof parsed?.data?.version === 'string'
        ? parsed.data.version
        : '';

    if (!latestVersion) {
      return { status: 'error', currentVersion, message: 'empty-latest-version' };
    }

    if (latestVersion === currentVersion) {
      return { status: 'latest', currentVersion, latestVersion };
    }

    if (!force) {
      const lastNotified = getLastNotified();
      if (lastNotified === latestVersion) {
        return { status: 'skip', currentVersion, latestVersion };
      }
    }

    // 统一：只要决定提示新版本，就标记一次（避免 App 自动检查反复弹）
    markNotified(latestVersion);
    if (openModal) openUpdateAvailableModal(latestVersion);
    return { status: 'update', currentVersion, latestVersion };
  } catch {
    if (openOnError) {
      // 与旧逻辑保持一致：兜底版本也需要做“是否已通知过”的去重
      if (fallbackVersion === currentVersion) {
        return { status: 'latest', currentVersion, latestVersion: fallbackVersion };
      }
      if (!force) {
        const lastNotified = getLastNotified();
        if (lastNotified === fallbackVersion) {
          return { status: 'skip', currentVersion, latestVersion: fallbackVersion };
        }
      }

      markNotified(fallbackVersion);
      if (openModal) openUpdateAvailableModal(fallbackVersion);
      return { status: 'update', currentVersion, latestVersion: fallbackVersion };
    }
    return { status: 'error', currentVersion, message: 'request-failed' };
  }
}
