import { BrowserWindow, screen, app } from 'electron';
import path from 'path';

let win: BrowserWindow | null = null;
let ready = false;
let pendingPayload: unknown = null;
let suspendedOnFullScreen = false;
let toastLockUntil = 0;
let toastHideTimer: NodeJS.Timeout | null = null;
let hoverPollTimer: NodeJS.Timeout | null = null;
let lastHovered = false;
const DEFAULT_WIDTH = 178;
const DEFAULT_HEIGHT = 72;
const MIN_WIDTH = 178;
const MAX_WIDTH = 560;
// 持续录音期间会常驻显示，轮询频率适度放宽以降低长期 CPU 占用
const HOVER_POLL_INTERVAL_MS = process.arch === 'x64' ? 130 : 110;
let currentWidth = DEFAULT_WIDTH;
let currentHeight = DEFAULT_HEIGHT;

function applyTopMost(winRef: BrowserWindow) {
  try {
    // macOS: normal 层级过低，容易被其它窗口覆盖；提升到 floating 保证可见性
    // Windows: 继续使用 screen-saver 作为顶层兜底
    const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
    winRef.setAlwaysOnTop(true, level);
  } catch {
    //
  }
  try {
    // 兜底：显式 moveTop，减少“同层窗口覆盖”的概率
    winRef.moveTop();
  } catch {
    //
  }
}

function setHovered(hovered: boolean) {
  lastHovered = !!hovered;
  try {
    if (win && !win.isDestroyed()) {
      // hovered 时允许点击；否则恢复鼠标穿透
      win.setIgnoreMouseEvents(!lastHovered, { forward: true });
      try {
        win.webContents.send('voice-indicator-hovered', { hovered: lastHovered });
      } catch {
        //
      }
    }
  } catch {
    //
  }
}

function stopHoverPoll() {
  if (hoverPollTimer) {
    try {
      clearInterval(hoverPollTimer);
    } catch {
      //
    }
    hoverPollTimer = null;
  }
  if (lastHovered) setHovered(false);
}

function startHoverPoll() {
  if (hoverPollTimer) return;
  hoverPollTimer = setInterval(() => {
    try {
      if (!win || win.isDestroyed() || !win.isVisible()) return stopHoverPoll();
      const pt = screen.getCursorScreenPoint();
      const b = win.getBounds();
      const hovered = pt.x >= b.x && pt.x <= b.x + b.width && pt.y >= b.y && pt.y <= b.y + b.height;
      if (hovered !== lastHovered) setHovered(hovered);
    } catch {
      // ignore polling errors
    }
  }, HOVER_POLL_INTERVAL_MS);
}

// Intel(macOS x64) 全屏退出问题兜底：全屏时禁用系统级悬浮窗，避免挡住系统 UI
export function setVoiceIndicatorSuspended(on: boolean) {
  suspendedOnFullScreen = !!on;
  if (suspendedOnFullScreen) {
    try {
      win?.hide();
    } catch {
      //
    }
  }
}

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

function position(w: BrowserWindow, size?: { width?: number; height?: number }) {
  try {
    // 需求：波动条不要跟随鼠标移动。
    // 定位策略：
    // - 优先使用“主窗口所在屏幕”的 workArea 底部居中（主窗口可跨屏移动，但不会跟鼠标飘）
    // - 找不到主窗口则使用主屏幕 workArea 底部居中
    let display = screen.getPrimaryDisplay();
    try {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { BrowserWindow } = require('electron') as typeof import('electron');

      // 选择一个“锚点窗口”（优先：当前聚焦窗口/全屏窗口；且排除 overlay/指示条等 alwaysOnTop 窗口）
      const isValidAnchor = (win: BrowserWindow | null | undefined) => {
        if (!win || win.isDestroyed()) return false;
        // 指示条/overlay 通常是 alwaysOnTop；不要拿它们当锚点
        try {
          if (typeof win.isAlwaysOnTop === 'function' && win.isAlwaysOnTop()) return false;
        } catch {
          //
        }
        return true;
      };

      let anchor: BrowserWindow | null = null;
      try {
        const focused = BrowserWindow.getFocusedWindow?.();
        if (isValidAnchor(focused)) anchor = focused as BrowserWindow;
      } catch {
        //
      }
      if (!anchor) {
        const wins = BrowserWindow.getAllWindows?.() || [];
        const candidates = wins.filter((x) => isValidAnchor(x));
        // 优先全屏窗口，其次可见窗口，最后按面积最大（主窗口通常最大）
        const score = (x: BrowserWindow) => {
          let s = 0;
          try {
            if (x.isFullScreen?.() || (x as any).isSimpleFullScreen?.()) s += 1000;
          } catch {
            //
          }
          try {
            if (x.isVisible?.()) s += 100;
          } catch {
            //
          }
          try {
            const b = x.getBounds?.();
            if (b && typeof b.width === 'number' && typeof b.height === 'number')
              s += b.width * b.height;
          } catch {
            //
          }
          return s;
        };
        candidates.sort((a, b) => score(b) - score(a));
        anchor = candidates[0] ?? null;
      }

      if (anchor) {
        const bounds = anchor.getBounds();
        // 用匹配矩形比“最近点”更稳（尤其是全屏/多屏边界附近）
        display = screen.getDisplayMatching(bounds);

        // macOS 全屏 Space：某些 Electron 版本下 window bounds 可能缺失多屏偏移，导致 getDisplayMatching 误判到主屏。
        // 兜底策略：当锚点窗口处于全屏时，优先用“鼠标所在屏幕”决定指示条显示屏幕（只在定位时取一次，不跟随鼠标移动）。
        try {
          const isFs = anchor.isFullScreen?.() || (anchor as any).isSimpleFullScreen?.();
          if (isFs) {
            const cursorPoint = screen.getCursorScreenPoint();
            display = screen.getDisplayNearestPoint(cursorPoint);
          }
        } catch {
          //
        }
      }
    } catch {
      // ignore and keep primary display
    }

    const { x, y, width, height } = display.workArea;
    const ww = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(size?.width ?? currentWidth)));
    const wh = Math.max(50, Math.round(size?.height ?? currentHeight));
    const left = Math.round(x + (width - ww) / 2);
    const top = Math.round(y + height - wh - 12);

    w.setBounds({ x: left, y: top, width: ww, height: wh }, false);
  } catch (error) {
    // 兜底：使用主显示器中央
    console.warn('[voiceIndicator] Positioning failed, using fallback:', error);
    try {
      const primaryDisplay = screen.getPrimaryDisplay();
      const { x, y, width, height } = primaryDisplay.workArea;
      const ww = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(size?.width ?? currentWidth)));
      const wh = Math.max(50, Math.round(size?.height ?? currentHeight));
      const left = Math.round(x + (width - ww) / 2);
      const top = Math.round(y + height - wh - 12);
      w.setBounds({ x: left, y: top, width: ww, height: wh }, false);
    } catch {
      // 最后的兜底
      const ww = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(size?.width ?? currentWidth)));
      const wh = Math.max(50, Math.round(size?.height ?? currentHeight));
      w.setBounds({ x: 100, y: 100, width: ww, height: wh }, false);
    }
  }
}

export function ensureVoiceIndicatorWindow() {
  if (win && !win.isDestroyed()) return win;

  ready = false;
  pendingPayload = null;

  win = new BrowserWindow({
    width: currentWidth,
    height: currentHeight,
    show: false,
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    focusable: false,
    backgroundColor: '#00000000',
    webPreferences: {
      // 指示条页通过 tsx 路由渲染，同时保留 nodeIntegration 以兼容现有逻辑
      nodeIntegration: true,
      contextIsolation: false,
      preload: getPreloadPath(),
      devTools: false,
    },
  });

  try {
    win.setHasShadow(false);
  } catch {
    //
  }
  applyTopMost(win);
  // Windows额外设置：确保在所有情况下都能显示在最顶层
  if (process.platform === 'win32') {
    try {
      // 设置为工具窗口，避免任务栏显示
      win.setSkipTaskbar(true);
      // 设置窗口样式，确保不被其他窗口遮挡
      win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    } catch {
      //
    }
  }
  try {
    // Intel(macOS x64)：避免在全屏空间显示 topmost 悬浮窗，防止挡住退出全屏交互
    const visibleOnFullScreen = !(process.platform === 'darwin' && process.arch === 'x64');
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen });
  } catch {
    //
  }
  try {
    // 永久鼠标穿透，不挡系统操作
    win.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    //
  }

  win.on('closed', () => {
    win = null;
    ready = false;
    pendingPayload = null;
    stopHoverPoll();
    currentWidth = DEFAULT_WIDTH;
    currentHeight = DEFAULT_HEIGHT;
  });

  position(win, { width: currentWidth, height: currentHeight });

  const devUrl = getDevRouteUrl('/voice-indicator');
  const loader = devUrl
    ? win.loadURL(devUrl)
    : win.loadFile(path.join(__dirname, '../../dist/index.html'), { hash: '/voice-indicator' });

  loader
    .then(() => {
      ready = true;
      if (pendingPayload && win && !win.isDestroyed()) {
        win.webContents.send('voice-indicator-set', pendingPayload);
        pendingPayload = null;
      }
    })
    .catch(() => undefined);

  return win;
}

export function resizeVoiceIndicatorWindow(size: { width?: number; height?: number }) {
  const nextW = typeof size?.width === 'number' ? size.width : currentWidth;
  const nextH = typeof size?.height === 'number' ? size.height : currentHeight;
  const w = Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(nextW)));
  const h = Math.max(50, Math.round(nextH));
  if (w === currentWidth && h === currentHeight) return;
  currentWidth = w;
  currentHeight = h;
  try {
    const bw = ensureVoiceIndicatorWindow();
    position(bw, { width: currentWidth, height: currentHeight });
  } catch {
    //
  }
}

export function updateVoiceIndicator(payload: {
  visible: boolean;
  status: 'speaking' | 'silent' | 'loading' | 'notice' | 'error';
  volumes?: number[] | null;
  message?: string;
  previewText?: string;
  autoHideMs?: number;
  resetTimer?: boolean;
  nonBlockingHint?: boolean;
}) {
  const now = Date.now();
  const isNonBlockingHint = payload?.nonBlockingHint === true;
  const isToast =
    !isNonBlockingHint &&
    (!!payload?.message || payload.status === 'notice' || payload.status === 'error');
  const forceResetTimer = !!payload?.resetTimer;
  const autoHideMs = typeof payload?.autoHideMs === 'number' ? payload.autoHideMs : 1600;

  // 1. 全屏静默检查（Mac Intel 兼容）
  if (suspendedOnFullScreen && payload?.visible) {
    try {
      win?.hide?.();
    } catch {
      //
    }
    return;
  }

  // 2. Toast 锁定检查：防止 toast 被后续的高频 visible:false 瞬间冲掉
  if (!forceResetTimer && !isToast && payload.visible === false && toastLockUntil > now) {
    return;
  }

  // 2.1 Toast 显示期间，忽略非 toast 的高频更新，避免 toast 立刻被 loading/波形覆盖
  if (!forceResetTimer && !isToast && toastLockUntil > now) {
    return;
  }

  // resetTimer 属于“新一轮录音会话开始”的强信号：清掉旧 toast 锁和旧自动隐藏计时器
  if (forceResetTimer) {
    toastLockUntil = 0;
    if (toastHideTimer) {
      try {
        clearTimeout(toastHideTimer);
      } catch {
        //
      }
      toastHideTimer = null;
    }
  }

  const w = ensureVoiceIndicatorWindow();

  // 3. 发送数据给渲染层
  if (ready) {
    w.webContents.send('voice-indicator-set', payload);
  } else {
    pendingPayload = payload;
  }

  // 4. 显示/隐藏逻辑
  if (isToast) {
    // --- Toast 模式 ---
    toastLockUntil = now + autoHideMs;
    if (toastHideTimer) clearTimeout(toastHideTimer);

    position(w);
    w.showInactive();
    applyTopMost(w);

    // Windows 强制置顶兜底
    if (process.platform === 'win32') {
      w.setAlwaysOnTop(true, 'screen-saver');
      w.moveTop();
    }

    toastHideTimer = setTimeout(() => {
      toastHideTimer = null;
      toastLockUntil = 0;
      try {
        if (w && !w.isDestroyed()) w.hide();
      } catch {
        //
      }
      stopHoverPoll();
    }, autoHideMs);
  } else if (payload.visible) {
    // --- 持续显示模式 (Recording/Loading) ---
    if (!w.isVisible()) {
      // 常驻模式固定回默认尺寸（toast 可能放大过）
      resizeVoiceIndicatorWindow({ width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT });
      position(w);
      w.showInactive();
      applyTopMost(w);

      // Windows 首次显示时强制置顶一次
      if (process.platform === 'win32') {
        setTimeout(() => {
          try {
            if (w && !w.isDestroyed() && w.isVisible()) {
              w.setAlwaysOnTop(true, 'screen-saver');
              w.moveTop();
            }
          } catch {
            //
          }
        }, 50);
      }
    }
    // 仅在常驻波动条模式下启用 hover（toast/提示不需要交互）
    startHoverPoll();
  } else {
    // --- 隐藏模式 ---
    if (toastHideTimer) {
      clearTimeout(toastHideTimer);
      toastHideTimer = null;
    }
    toastLockUntil = 0;
    w.hide();
    stopHoverPoll();
  }
}
