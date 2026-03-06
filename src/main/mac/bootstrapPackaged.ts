import { app } from 'electron';

/**
 * 打包版默认关闭日志，避免 console/原生逐键 debug 导致卡顿或无响应。
 *
 * 可通过环境变量显式开启：
 * - SENSETYPE_ENABLE_LOGS=1
 */
const logsEnabled = !app.isPackaged || String(process.env.SENSETYPE_ENABLE_LOGS || '') === '1';

// 原生 keyhook 逐键 debug 日志：打包版强制关闭（避免外部环境变量误开导致整机输入卡顿）
if (app.isPackaged) {
  process.env.SENSETYPE_KEYHOOK_DEBUG = '0';
}

if (!logsEnabled) {
  const noop = () => {};
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).log = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).info = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).warn = noop;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any).debug = noop;
  } catch {
    // ignore
  }
}
