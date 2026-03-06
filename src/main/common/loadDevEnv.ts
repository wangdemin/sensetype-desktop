import path from 'node:path';
import fs from 'node:fs';
import dotenv from 'dotenv';

let loaded = false;

/**
 * 主进程开发态加载 `.env.development*`（vite 不一定会自动注入到 main process 的 process.env）。
 *
 * - 仅在 `!app.isPackaged` 场景调用（由调用方控制）
 * - 不覆盖已存在的 process.env（dotenv 默认行为）
 */
export function loadDevEnvOnce(opts?: { projectRoot?: string }) {
  if (loaded) return;
  loaded = true;

  const root = opts?.projectRoot || process.cwd();
  const candidates = ['.env.development.local', '.env.development'];

  for (const rel of candidates) {
    const p = path.resolve(root, rel);
    try {
      if (fs.existsSync(p) && fs.statSync(p).isFile()) {
        dotenv.config({ path: p, override: false });
      }
    } catch {
      // ignore
    }
  }
}
