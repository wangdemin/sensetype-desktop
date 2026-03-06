import * as fs from 'fs';
import path from 'path';
import { app } from 'electron';

/**
 * Electron 主进程图标路径（Tray / BrowserWindow）。
 * 统一使用 logo-16.png：
 * - 开发环境：public/assets/logo-16.png
 * - 打包环境：dist/assets/logo-16.png（来自 public 目录拷贝，文件名稳定不带 hash）
 */
export function getIconPath() {
  const candidates = [
    // packaged: prefer dist assets (stable name)
    path.join(process.resourcesPath, 'app.asar', 'dist', 'assets', 'logo-16.png'),
    path.join(app.getAppPath(), 'dist', 'assets', 'logo-16.png'),
    // dev / local build outputs
    path.join(process.cwd(), 'dist', 'assets', 'logo-16.png'),
    // dev public assets
    path.join(app.getAppPath(), 'public', 'assets', 'logo-16.png'),
    path.join(process.cwd(), 'public', 'assets', 'logo-16.png'),
    // dev source assets
    path.join(app.getAppPath(), 'src', 'assets', 'logo-16.png'),
    path.join(app.getAppPath(), 'src', 'assets', 'images', 'logo-16.png'),
    path.join(process.cwd(), 'src', 'assets', 'images', 'logo-16.png'),
  ];

  return candidates.find((p) => fs.existsSync(p)) ?? candidates[candidates.length - 1];
}
