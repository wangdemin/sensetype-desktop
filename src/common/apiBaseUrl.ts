/**
 * 统一的 API BaseURL 处理（默认值 + 规范化）
 *
 * 约定：
 * - 这里仅提供“默认值”和“去尾斜杠”等纯函数，避免引入 import.meta / process，
 *   以便同时被主进程与渲染进程安全复用。
 */
// NOTE:
// This module is shared by both renderer and main-process builds.
// The main-process Vite build (via vite-plugin-electron) may not inherit the root alias config,
// so avoid using "@/..." aliases here and prefer relative imports.
import config from '../config';
export const DEFAULT_API_BASE_URL = config.apiBaseUrl;

export function normalizeBaseUrl(v: unknown, fallback: string = DEFAULT_API_BASE_URL): string {
  const s = typeof v === 'string' ? v.trim() : '';
  if (!s) return fallback;
  // 去掉末尾的斜杠，避免出现 //api
  return s.endsWith('/') ? s.slice(0, -1) : s;
}
