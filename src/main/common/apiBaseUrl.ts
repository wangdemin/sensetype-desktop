import { DEFAULT_API_BASE_URL, normalizeBaseUrl } from '../../common/apiBaseUrl';

/**
 * 主进程使用的 API BaseURL。
 *
 * 注意：
 * - 主进程里通常拿不到 `import.meta.env`，因此只读 `process.env`
 */
export function getMainApiBaseUrl(): string {
  const raw = DEFAULT_API_BASE_URL;
  return normalizeBaseUrl(raw, DEFAULT_API_BASE_URL);
}
