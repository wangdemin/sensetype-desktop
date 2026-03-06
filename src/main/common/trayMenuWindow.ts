import { BrowserWindow, Tray, ipcMain, screen, app } from 'electron';
import path, { join } from 'path';
import pkg from '../../../package.json';
import { getUserInfo } from './authCache';
import appConfig from '../../config';

type TrayMenuAction =
  | 'open-home'
  | 'open-notes'
  | 'open-update'
  | 'open-settings'
  | 'close-main'
  | 'quit';

type TrayMenuHandlers = {
  onBeforeShow?: () => void;
  showMainWindow: () => void;
  hideMainWindow: () => void;
  navigate: (page: 'home' | 'notes' | 'about' | 'settings') => void;
  checkUpdate: () => void;
  quit: () => void;
};

let handlers: TrayMenuHandlers | null = null;
let trayMenuWin: BrowserWindow | null = null;
let trayMenuReady = false;
let ipcBound = false;
let lastToggleAt = 0;
let pendingShow = false;
let pendingShowTray: Tray | null = null;

function getDevRouteUrl(hashPath: string) {
  const base = process.env.VITE_DEV_SERVER_URL;
  if (!base) return null;
  // 加时间戳避免开发态缓存
  return new URL(`/#${hashPath}?t=${Date.now()}`, base).toString();
}

function getPreloadPath() {
  return app.isPackaged
    ? path.join(__dirname, '../../dist/preload.js')
    : path.join(__dirname, '../../public/preload.js');
}

function clamp(n: number, min: number, max: number) {
  return Math.max(min, Math.min(max, n));
}

function buildState() {
  const u = getUserInfo() as Record<string, unknown> | null;
  const pointsRaw = (u?.points ?? u?.point ?? u?.score) as number | string | null | undefined;
  const points =
    typeof pointsRaw === 'number' || typeof pointsRaw === 'string' ? pointsRaw : undefined;
  const version = String((pkg as { version?: string })?.version ?? '').trim() || app.getVersion();
  return { version, points };
}

function sendState() {
  if (!trayMenuWin || trayMenuWin.isDestroyed()) return;
  try {
    trayMenuWin.webContents.send('tray-menu-state', buildState());
  } catch {
    // ignore
  }
}

function positionAtTray(w: BrowserWindow, tray: Tray) {
  const trayBounds = tray.getBounds();
  const cursor = screen.getCursorScreenPoint();
  const anchorPoint = {
    x: trayBounds?.x + Math.round((trayBounds?.width || 0) / 2) || cursor.x,
    y: trayBounds?.y + Math.round((trayBounds?.height || 0) / 2) || cursor.y,
  };

  const display = screen.getDisplayNearestPoint(anchorPoint);
  const work = display.workArea;

  const [ww, wh] = w.getSize();

  // 经验规则：
  // - 托盘在底部：菜单向上弹
  // - 托盘在顶部：菜单向下弹
  // - 其它位置：优先让菜单落在 workArea 内
  const trayIsBottom = trayBounds.y > work.y + work.height / 2;
  const margin = 8;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - ww / 2);
  x = clamp(x, work.x + margin, work.x + work.width - ww - margin);

  let y = trayIsBottom
    ? Math.round(trayBounds.y - wh - margin)
    : Math.round(trayBounds.y + trayBounds.height + margin);
  y = clamp(y, work.y + margin, work.y + work.height - wh - margin);

  try {
    w.setBounds({ x, y, width: ww, height: wh }, false);
  } catch {
    // ignore
  }
}

function ensureWindow() {
  if (trayMenuWin && !trayMenuWin.isDestroyed()) return trayMenuWin;

  trayMenuReady = false;
  pendingShow = false;
  pendingShowTray = null;

  trayMenuWin = new BrowserWindow({
    width: 256,
    height: 254,
    show: false,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    // macOS 上如果一开始就 alwaysOnTop，会先以默认层级出现；这里延后到 setAlwaysOnTop 指定层级
    alwaysOnTop: process.platform === 'darwin' ? false : true,
    // 需求：只在“点击菜单外”时隐藏（blur），因此需要可聚焦
    focusable: true,
    backgroundColor: '#FFFFFF',
    webPreferences: {
      webSecurity: false,
      nodeIntegration: true,
      contextIsolation: false,
      preload: getPreloadPath(),
      devTools: appConfig.devTools,
    },
  });

  try {
    // macOS：降到 normal(0) 避免遮挡截图工具；其它平台仍用 pop-up-menu
    const level = process.platform === 'darwin' ? 'normal' : 'pop-up-menu';
    trayMenuWin.setAlwaysOnTop(true, level);
  } catch {
    // ignore
  }

  trayMenuWin.on('closed', () => {
    trayMenuWin = null;
    trayMenuReady = false;
    pendingShow = false;
    pendingShowTray = null;
  });

  // 点击菜单外：窗口失焦后隐藏（不会因为鼠标移开就隐藏）
  trayMenuWin.on('blur', () => {
    try {
      trayMenuWin?.hide?.();
    } catch {
      // ignore
    }
  });

  // 首次加载：等到 ready-to-show（首帧已渲染）再允许显示，避免右键第一次闪白屏
  trayMenuWin.once('ready-to-show', () => {
    trayMenuReady = true;
    sendState();
    if (pendingShow && pendingShowTray && trayMenuWin && !trayMenuWin.isDestroyed()) {
      try {
        positionAtTray(trayMenuWin, pendingShowTray);
      } catch {
        // ignore
      }
      try {
        trayMenuWin.show();
        trayMenuWin.focus();
      } catch {
        try {
          trayMenuWin.show();
        } catch {
          // ignore
        }
      }
    }
    pendingShow = false;
    pendingShowTray = null;
  });

  const devUrl = getDevRouteUrl('/tray-menu');
  const loader = devUrl
    ? trayMenuWin.loadURL(devUrl)
    : trayMenuWin.loadFile(join(__dirname, '../../dist/index.html'), { hash: '/tray-menu' });
  loader
    .then(() => {
      // load 完成不等于首帧已绘制；真正展示以 ready-to-show 为准
      sendState();
    })
    .catch(() => {
      // ignore
    });

  return trayMenuWin;
}

export function initTrayMenuWindow(nextHandlers: TrayMenuHandlers) {
  handlers = nextHandlers;
  if (ipcBound) return;
  ipcBound = true;

  ipcMain.handle('tray-menu-get-state', async () => {
    return buildState();
  });

  ipcMain.on('tray-menu-hide', () => {
    try {
      trayMenuWin?.hide?.();
    } catch {
      // ignore
    }
  });

  ipcMain.on('tray-menu-action', (_event, payload: { action?: TrayMenuAction }) => {
    const action = String(payload?.action || '') as TrayMenuAction;
    const h = handlers;
    if (!h) return;

    // 关键：先隐藏菜单，再执行动作。
    // 否则如果 showMainWindow / getOrCreateWindow 等比较慢，会导致“点了但菜单不消失”的体感延迟很高。
    const run = (fn: () => void) => {
      try {
        trayMenuWin?.hide?.();
      } catch {
        // ignore
      }
      setTimeout(() => {
        try {
          fn();
        } catch {
          // ignore
        }
      }, 0);
    };

    if (action === 'open-home') {
      return run(() => {
        h.onBeforeShow?.();
        h.showMainWindow();
        h.navigate('home');
      });
    }
    if (action === 'open-notes') {
      return run(() => {
        h.onBeforeShow?.();
        h.showMainWindow();
        h.navigate('notes');
      });
    }
    if (action === 'open-update') {
      return run(() => {
        h.onBeforeShow?.();
        h.showMainWindow();
        h.navigate('about');
        h.checkUpdate();
      });
    }
    if (action === 'open-settings') {
      return run(() => {
        h.onBeforeShow?.();
        h.showMainWindow();
        h.navigate('settings');
      });
    }
    if (action === 'close-main') {
      return run(() => {
        h.hideMainWindow();
      });
    }
    if (action === 'quit') {
      return run(() => {
        h.quit();
      });
    }
  });

  // 预热：提前创建并开始加载（保持隐藏），避免首次右键出现白屏
  try {
    ensureWindow();
  } catch {
    // ignore
  }
}

export function hideTrayMenuWindow() {
  try {
    trayMenuWin?.hide?.();
  } catch {
    // ignore
  }
}

export function toggleTrayMenuWindow(tray: Tray) {
  // Tray 右键在部分系统/设备上可能会同时触发 right-click + mouse-up，
  // 这里做一个极轻量的节流，避免“显示后立刻又被隐藏”的抖动。
  const now = Date.now();
  if (now - lastToggleAt < 250) return;
  lastToggleAt = now;

  const w = ensureWindow();
  if (w.isVisible()) {
    try {
      w.hide();
    } catch {
      // ignore
    }
    return;
  }

  sendState();
  positionAtTray(w, tray);
  // 首次：如果还没 ready-to-show，先记下“待显示”请求，等首帧渲染完成再 show，避免白屏闪烁
  if (!trayMenuReady) {
    pendingShow = true;
    pendingShowTray = tray;
    return;
  }

  try {
    // 显示并聚焦：确保点击菜单外能触发 blur 从而隐藏
    w.show();
    w.focus();
  } catch {
    try {
      w.show();
    } catch {
      // ignore
    }
  }
}
