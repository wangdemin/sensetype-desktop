/**
 * Web 站点 baseUrl（用于打开 auth-intermediate、协议页面等）。
 *
 * - 允许通过环境变量覆盖：VITE_WEB_BASE_URL
 */
import config from '@/config';
export function getWebBaseUrl(): string {
  return config.webBaseUrl;
}
