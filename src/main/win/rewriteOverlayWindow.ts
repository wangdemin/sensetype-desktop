import { app, BrowserWindow, clipboard, screen } from 'electron';
import path from 'path';
import appConfig from '../../config';

type RewriteOverlaySetPayload = {
  text: string;
  questionText?: string;
};

type ShowRewriteOverlayOptions = {
  questionText?: string;
};

let overlayWin: BrowserWindow | null = null;
let overlayReady = false;
let pendingPayload: RewriteOverlaySetPayload | null = null;
let isHovered = false;
let isEditing = false;
let overlayLoadPromise: Promise<void> | null = null;
let overlayLoadError: Error | null = null;

function getAnchorWindow() {
  // 选择一个“锚点窗口”（通常是主窗口）。排除 overlay/指示条等 alwaysOnTop 窗口。
  try {
    const focused = BrowserWindow.getFocusedWindow?.();
    if (focused && !focused.isDestroyed()) {
      try {
        if (typeof focused.isAlwaysOnTop === 'function' && focused.isAlwaysOnTop()) {
          // ignore
        } else {
          return focused;
        }
      } catch {
        return focused;
      }
    }
  } catch {
    // ignore
  }
  try {
    const wins = BrowserWindow.getAllWindows?.() || [];
    const candidates = wins.filter((w) => {
      if (!w || w.isDestroyed()) return false;
      try {
        if (typeof w.isAlwaysOnTop === 'function' && w.isAlwaysOnTop()) return false;
      } catch {
        //
      }
      return true;
    });
    candidates.sort((a, b) => {
      const area = (x: BrowserWindow) => {
        try {
          const bb = x.getBounds();
          return (bb?.width || 0) * (bb?.height || 0);
        } catch {
          return 0;
        }
      };
      return area(b) - area(a);
    });
    return candidates[0] ?? null;
  } catch {
    return null;
  }
}

function getOverlayDisplay() {
  // 期望：App 前台（如新手引导）时悬浮窗出现在“主窗口所在屏幕”，避免鼠标在另一屏导致切屏。
  // App 不在前台（如外部应用选中文本触发）时退回到“鼠标所在屏幕”，更符合用户直觉。
  try {
    const anchor = getAnchorWindow();
    if (anchor && !anchor.isDestroyed()) {
      try {
        const bounds = anchor.getBounds();
        return screen.getDisplayMatching(bounds);
      } catch {
        // ignore and fallback
      }
    }
  } catch {
    // ignore and fallback
  }

  const cursor = screen.getCursorScreenPoint();
  return screen.getDisplayNearestPoint(cursor);
}

function applyInteractivity() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  try {
    const allowMouse = isEditing || isHovered;
    overlayWin.setIgnoreMouseEvents(!allowMouse, { forward: true });
  } catch {
    //
  }
  try {
    // focusable: false blocks typing in textarea; enable it only while editing
    overlayWin.setFocusable(!!isEditing);
  } catch {
    //
  }
}

function getDevRouteUrl(hashPath: string) {
  const base = process.env.VITE_DEV_SERVER_URL;
  if (!base) return null;
  return new URL(`/#${hashPath}?t=${Date.now()}`, base).toString();
}

function getOverlayBounds() {
  const display = getOverlayDisplay();
  const { x, y, width, height } = display.workArea;
  return { x, y, width, height };
}

function positionOverlay(win: BrowserWindow) {
  win.setBounds(getOverlayBounds(), false);
}

export function ensureRewriteOverlayWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;

  overlayReady = false;
  pendingPayload = null;
  isHovered = false;
  isEditing = false;
  overlayLoadPromise = null;
  overlayLoadError = null;

  const bounds = getOverlayBounds();
  overlayWin = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
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
      nodeIntegration: true,
      contextIsolation: false,
      devTools: appConfig.devTools,
    },
  });

  try {
    overlayWin.setHasShadow(false);
  } catch {
    //
  }
  // Windows：提升层级，避免被其它 topmost 窗口压住
  try {
    overlayWin.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    //
  }
  try {
    overlayWin.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    //
  }

  overlayWin.on('closed', () => {
    overlayWin = null;
    overlayReady = false;
    pendingPayload = null;
  });

  positionOverlay(overlayWin);

  const devUrl = getDevRouteUrl('/rewrite-overlay');
  const loader = devUrl
    ? overlayWin.loadURL(devUrl)
    : overlayWin.loadFile(path.join(__dirname, '../../dist/index.html'), {
        hash: '/rewrite-overlay',
      });
  overlayLoadPromise = loader.then(
    () => {
      overlayReady = true;
      if (pendingPayload) {
        overlayWin?.webContents.send('rewrite-overlay-set', pendingPayload);
        pendingPayload = null;
      }
    },
    (e) => {
      overlayReady = false;
      overlayLoadError = e instanceof Error ? e : new Error(String(e));
      try {
        // 避免卡在“永远不 ready”的半残窗口；下次 show 时会重建
        overlayWin?.destroy();
      } catch {
        //
      }
      overlayWin = null;
      pendingPayload = null;
      throw overlayLoadError;
    },
  );

  return overlayWin;
}

export function showRewriteOverlay(text: string, options: ShowRewriteOverlayOptions = {}) {
  const wasAppFocused = (() => {
    try {
      return !!BrowserWindow.getFocusedWindow?.();
    } catch {
      return false;
    }
  })();
  const anchor = wasAppFocused ? getAnchorWindow() : null;
  const win = ensureRewriteOverlayWindow();
  const t = (text || '').trim();
  if (!t) return;
  const q = String(options.questionText || '').trim();
  const payload: RewriteOverlaySetPayload = q ? { text: t, questionText: q } : { text: t };

  try {
    clipboard.writeText(t);
  } catch {
    //
  }

  // 关键：如果上一次隐藏发生在 hover/edit 状态（可能收不到 mouseleave/blur），
  // 会导致下一次显示不再鼠标穿透，从而“挡住”主窗口。
  try {
    if (!win.isVisible()) {
      isHovered = false;
      isEditing = false;
      applyInteractivity();
    }
  } catch {
    // ignore
  }

  if (overlayReady) {
    win.webContents.send('rewrite-overlay-set', payload);
  } else {
    pendingPayload = payload;
  }

  positionOverlay(win);
  try {
    win.setAlwaysOnTop(true, 'screen-saver');
  } catch {
    //
  }
  try {
    win.showInactive();
  } catch {
    win.show();
  }

  // App 本来就在前台（新手引导场景）时：弹出悬浮窗后，显式拉回主窗口，防止它被挤到后面。
  if (wasAppFocused && anchor && !anchor.isDestroyed()) {
    setTimeout(() => {
      try {
        anchor.show();
        anchor.focus();
        anchor.moveTop();
      } catch {
        //
      }
    }, 50);
  }
}

async function waitOverlayReady(timeoutMs = 1500) {
  if (overlayReady) return;
  if (overlayLoadError) throw overlayLoadError;
  if (!overlayLoadPromise) throw new Error('重写悬浮窗未初始化');
  let timer: NodeJS.Timeout | null = null;
  try {
    await Promise.race([
      overlayLoadPromise,
      new Promise<void>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('重写悬浮窗加载超时')), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
  if (overlayLoadError) throw overlayLoadError;
  if (!overlayReady) throw new Error('重写悬浮窗未就绪');
}

export async function showRewriteOverlayAndWait(
  text: string,
  options: ShowRewriteOverlayOptions = {},
) {
  const t = (text || '').trim();
  if (!t) return;
  const q = String(options.questionText || '').trim();
  const payload: RewriteOverlaySetPayload = q ? { text: t, questionText: q } : { text: t };
  const win = ensureRewriteOverlayWindow();
  // 设置 pendingPayload，确保 ready 后一定会收到文本
  pendingPayload = payload;
  try {
    await waitOverlayReady(3000);
  } catch {
    // 超时或加载失败：降级为非阻塞显示（pendingText 已设置，HTML 加载完成后会自动投递）
    console.warn('[rewriteOverlay] waitOverlayReady failed, falling back to non-blocking show');
    try {
      showRewriteOverlay(t, options);
    } catch {
      // ignore
    }
    return;
  }
  try {
    if (win && !win.isDestroyed()) {
      win.webContents.send('rewrite-overlay-set', payload);
    }
  } catch {
    // ignore - set 失败不应阻塞显示
  }
  try {
    showRewriteOverlay(t, options);
  } catch (e) {
    throw e instanceof Error ? e : new Error(String(e));
  }
}

/** 预热：提前创建悬浮窗并加载页面，避免首次展示时因加载耗时导致超时 */
export function preloadRewriteOverlay() {
  try {
    ensureRewriteOverlayWindow();
  } catch {
    // ignore
  }
}

export function hideRewriteOverlay() {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  // 隐藏时复位交互态，避免下次显示时整屏拦截鼠标/抢焦点
  isHovered = false;
  isEditing = false;
  applyInteractivity();
  overlayWin.hide();
}

export function setRewriteOverlayHovered(hovered: boolean) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  isHovered = hovered;
  applyInteractivity();
}

export function setRewriteOverlayEditable(editing: boolean) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  isEditing = editing;
  applyInteractivity();
  if (editing) {
    try {
      overlayWin.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      //
    }
    try {
      overlayWin.show();
      overlayWin.focus();
    } catch {
      //
    }
  }
}
