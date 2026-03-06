import { app, BrowserWindow, clipboard, ipcMain, screen } from 'electron';
import path from 'path';
import appConfig from '../../config';

type RewriteOverlaySetPayload = {
  text: string;
  questionText?: string;
};

let overlayWin: BrowserWindow | null = null;
let overlayReady = false;
let pendingPayload: RewriteOverlaySetPayload | null = null;
let isHovered = false;
let isEditing = false;
let overlayFromBackground = false;
let overlaySkipPrimaryWindowHide = false;
let suspendedOnFullScreen = false;
let overlayLoadPromise: Promise<void> | null = null;
let overlayLoadError: Error | null = null;
// macOS 光标位置轮询：当 forward: true 机制不可靠时，通过主进程定期检测光标是否在卡片区域来兜底
let cardBounds: { left: number; top: number; width: number; height: number } | null = null;
let hoverPollTimer: ReturnType<typeof setInterval> | null = null;
let ipcBoundsRegistered = false;
// 降低长时间显示时的主进程轮询负担（Intel 机型进一步放宽频率）
const HOVER_POLL_INTERVAL_MS = process.arch === 'x64' ? 150 : 120;

// Intel(macOS x64) 全屏退出问题兜底：全屏时禁用系统级重写悬浮窗，避免挡住系统 UI
export function setRewriteOverlaySuspended(on: boolean) {
  suspendedOnFullScreen = !!on;
  if (suspendedOnFullScreen) {
    try {
      hideRewriteOverlay();
    } catch {
      //
    }
  }
}

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
    // 选面积最大的可见窗口（主窗口通常最大）
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

function hideVisiblePrimaryWindows() {
  try {
    const wins = BrowserWindow.getAllWindows?.() || [];
    for (const w of wins) {
      if (!w || w.isDestroyed()) continue;
      if (overlayWin && w.id === overlayWin.id) continue;
      try {
        if (typeof w.isAlwaysOnTop === 'function' && w.isAlwaysOnTop()) continue;
      } catch {
        // ignore
      }
      try {
        if (w.isVisible?.()) w.hide();
      } catch {
        // ignore
      }
    }
  } catch {
    // ignore
  }
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
    // 编辑态始终允许 overlay 获取焦点，避免“本应用内重写结果无法编辑”。
    // 后台场景由 show/setEditable 前的 hideVisiblePrimaryWindows 负责防主窗抬前。
    const canFocusOverlay = !!isEditing;
    overlayWin.setFocusable(canFocusOverlay);
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

/**
 * 注册 IPC 接收渲染进程上报的卡片位置信息（仅注册一次）。
 * 卡片位置用于主进程光标轮询，判断光标是否在卡片区域。
 */
function registerCardBoundsIPC() {
  if (ipcBoundsRegistered) return;
  ipcBoundsRegistered = true;
  ipcMain.on(
    'rewrite-overlay-card-bounds',
    (
      _event: Electron.IpcMainEvent,
      payload: { left: number; top: number; width: number; height: number },
    ) => {
      if (payload && typeof payload.left === 'number') {
        cardBounds = {
          left: payload.left,
          top: payload.top,
          width: payload.width,
          height: payload.height,
        };
      }
    },
  );
}

/**
 * 启动主进程光标位置轮询。
 * macOS 上 Electron 的 setIgnoreMouseEvents(true, { forward: true }) 依赖 NSTrackingArea
 * 转发鼠标移动事件，但在 showInactive() 后或快速显隐切换时可能无法正常工作。
 * 通过主进程定期检测 screen.getCursorScreenPoint() 是否落在卡片区域，
 * 作为渲染进程 mouseenter/mouseleave 的可靠兜底。
 */
function startHoverPoll() {
  stopHoverPoll();
  hoverPollTimer = setInterval(() => {
    if (!overlayWin || overlayWin.isDestroyed() || !overlayWin.isVisible()) {
      stopHoverPoll();
      return;
    }
    // 编辑态由渲染进程控制，不覆盖
    if (isEditing) return;
    // 渲染进程尚未上报卡片位置，跳过本次检测
    if (!cardBounds) return;
    try {
      const cursor = screen.getCursorScreenPoint();
      const winBounds = overlayWin.getBounds();
      // 将屏幕坐标转换为窗口内相对坐标
      const relX = cursor.x - winBounds.x;
      const relY = cursor.y - winBounds.y;
      // 添加少量边距容差，避免边缘像素抖动
      const pad = 4;
      const hovered =
        relX >= cardBounds.left - pad &&
        relX <= cardBounds.left + cardBounds.width + pad &&
        relY >= cardBounds.top - pad &&
        relY <= cardBounds.top + cardBounds.height + pad;
      if (hovered !== isHovered) {
        isHovered = hovered;
        applyInteractivity();
      }
    } catch {
      //
    }
  }, HOVER_POLL_INTERVAL_MS);
}

function stopHoverPoll() {
  if (hoverPollTimer) {
    clearInterval(hoverPollTimer);
    hoverPollTimer = null;
  }
}

export function ensureRewriteOverlayWindow() {
  if (overlayWin && !overlayWin.isDestroyed()) return overlayWin;

  console.log(123);

  overlayReady = false;
  pendingPayload = null;
  isHovered = false;
  isEditing = false;
  overlayFromBackground = false;
  overlaySkipPrimaryWindowHide = false;
  overlayLoadPromise = null;
  overlayLoadError = null;
  cardBounds = null;

  registerCardBoundsIPC();

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
    // macOS：避免悬浮窗抢占焦点导致前台应用修饰键状态异常/丢失
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
  try {
    // macOS：使用 floating 层级，避免被主窗口挤到后面；仍低于更高系统级窗口。
    const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
    overlayWin.setAlwaysOnTop(true, level);
  } catch {
    //
  }

  try {
    overlayWin.setIgnoreMouseEvents(true, { forward: true });
  } catch {
    //
  }
  try {
    // Intel(macOS x64)：避免在全屏空间显示 topmost 悬浮窗，防止挡住退出全屏交互
    const visibleOnFullScreen = !(process.platform === 'darwin' && process.arch === 'x64');
    // macOS: 默认会触发 process type transform，可能导致 Dock/窗口短暂异常；这里显式跳过。
    overlayWin.setVisibleOnAllWorkspaces(true, {
      visibleOnFullScreen,
      skipTransformProcessType: true,
    });
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

type ShowRewriteOverlayOptions = {
  questionText?: string;
  // 仅用于“本应用引导页”这类需要保留主窗可见性的场景
  skipHidePrimaryWindows?: boolean;
};

export function showRewriteOverlay(text: string, options: ShowRewriteOverlayOptions = {}) {
  if (suspendedOnFullScreen && process.platform === 'darwin' && process.arch === 'x64') return;
  const wasAppFocused = (() => {
    try {
      return !!BrowserWindow.getFocusedWindow?.();
    } catch {
      return false;
    }
  })();
  overlayFromBackground = !wasAppFocused;
  const win = ensureRewriteOverlayWindow();
  overlaySkipPrimaryWindowHide = !!options.skipHidePrimaryWindows;
  const t = (text || '').trim();
  if (!t) return;
  const q = String(options.questionText || '').trim();
  const payload: RewriteOverlaySetPayload = q ? { text: t, questionText: q } : { text: t };

  console.log(3333);

  // 当应用不在前台（外部应用场景）时，先隐藏可见主窗，避免 overlay 点击后首页被抬到最前。
  if (overlayFromBackground && !overlaySkipPrimaryWindowHide) {
    hideVisiblePrimaryWindows();
  }

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
    const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
    win.setAlwaysOnTop(true, level);
  } catch {
    //
  }
  try {
    win.showInactive();
  } catch {
    win.show();
  }

  // macOS: showInactive() 后重新设置 setIgnoreMouseEvents 以确保 NSTrackingArea 被正确初始化，
  // 否则 forward: true 可能无法正常转发鼠标移动事件，导致卡片区域始终处于点击穿透状态。
  if (process.platform === 'darwin') {
    setTimeout(() => {
      try {
        if (overlayWin && !overlayWin.isDestroyed() && overlayWin.isVisible()) {
          const allowMouse = isEditing || isHovered;
          overlayWin.setIgnoreMouseEvents(!allowMouse, { forward: true });
        }
      } catch {
        //
      }
    }, 50);
  }

  // 启动光标位置轮询：当 forward: true 不可靠时，通过主进程定期检测光标是否在卡片区域来兜底
  startHoverPoll();
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
  // 调用方传入的待展示文本（可能带空白/换行，需要规范化）。
  text: string,
  // 控制展示行为的可选参数（例如是否隐藏主窗口等），默认空配置。
  options: ShowRewriteOverlayOptions = {},
) {
  // Intel macOS 全屏挂起态下直接短路，避免已知的悬浮窗/全屏交互问题。
  if (suspendedOnFullScreen && process.platform === 'darwin' && process.arch === 'x64') return;
  // 统一裁剪文本，避免纯空白触发展示/IPC。
  const t = (text || '').trim();
  // 空文本不展示，直接返回。
  if (!t) return;
  const q = String(options.questionText || '').trim();
  const payload: RewriteOverlaySetPayload = q ? { text: t, questionText: q } : { text: t };
  // 确保 overlay 窗口实例存在（必要时创建并开始加载）。
  const win = ensureRewriteOverlayWindow();
  // 记录 pendingPayload：即使窗口尚未 ready，后续也能在加载完成后投递文本。
  pendingPayload = payload;
  // 优先尝试等待 overlay 页面 ready（避免首次展示时 set 文本丢失）。
  try {
    // 最多等待 3s；超时则走降级路径（非阻塞展示）。
    await waitOverlayReady(3000);
    // ready 等待失败不抛出到上层：进入降级逻辑即可。
  } catch {
    // 超时或加载失败：降级为非阻塞显示（pendingText 已设置，HTML 加载完成后会自动投递）
    console.warn('[rewriteOverlay] waitOverlayReady failed, falling back to non-blocking show');
    // 降级路径：尽力展示悬浮窗，不要求窗口已 ready。
    try {
      // 直接展示（文本已在 pendingText 中；若窗口稍后 ready，也能补发）。
      showRewriteOverlay(t, options);
      // 降级展示失败也不应让调用链崩溃（后续仍可继续主流程）。
    } catch {
      // ignore
    }
    // 降级展示后结束：不再继续向 webContents 主动推送文本。
    return;
  }
  // ready 后：尝试主动把文本推给 overlay 渲染页，确保 UI 立即拿到内容。
  try {
    // 窗口可能在等待期间被销毁/关闭，先做健壮性检查。
    if (win && !win.isDestroyed()) {
      // 通过 overlay 自己的 channel 设置文本（渲染页监听后更新展示）。
      win.webContents.send('rewrite-overlay-set', payload);
    }
    // set 文本失败不应阻塞显示动作（最多是内容稍后由 pendingText 补上）。
  } catch {
    // ignore
  }
  // 最后执行展示动作（置顶/定位/显示等），让用户看到悬浮窗。
  try {
    // 这里是真正的 show 行为；上面 send 只是数据投递。
    showRewriteOverlay(t, options);
    // show 报错需要上抛，让上层能拿到 invoke 的失败结果。
  } catch (e) {
    // 统一转成 Error，便于上层 handler 回传 error message。
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
  stopHoverPoll();
  if (!overlayWin || overlayWin.isDestroyed()) return;
  // 隐藏时复位交互态，避免下次显示时整屏拦截鼠标/抢焦点
  isHovered = false;
  isEditing = false;
  overlayFromBackground = false;
  overlaySkipPrimaryWindowHide = false;
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
  if (editing && overlayFromBackground && !overlaySkipPrimaryWindowHide) {
    // 点击进入编辑前再做一次兜底，防止激活链路把主窗口重新抬出。
    hideVisiblePrimaryWindows();
  }
  // 兼容旧调用：只维护状态并复用统一的交互切换逻辑
  isEditing = !!editing;
  applyInteractivity();
  if (editing) {
    try {
      const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
      overlayWin.setAlwaysOnTop(true, level);
    } catch {
      //
    }
    try {
      overlayWin.show();
    } catch {
      //
    }
    try {
      overlayWin.focus();
    } catch {
      //
    }
  }
}

// 当用户在悬浮窗内进入“编辑/交互”模式时：
// - 允许窗口获得焦点（否则输入框无法正常输入）
// - 取消鼠标穿透（否则无法点击/选中文本）
// 退出编辑模式后恢复默认“非抢焦点 + 鼠标穿透”，避免影响前台应用的修饰键状态。
export function setRewriteOverlayInteractivity(editing: boolean) {
  if (!overlayWin || overlayWin.isDestroyed()) return;
  const on = !!editing;
  try {
    // Electron 支持动态切换 focusable（mac 上用于避免抢焦点）
    (overlayWin as unknown as { setFocusable?: (v: boolean) => void }).setFocusable?.(on);
  } catch {
    //
  }
  try {
    overlayWin.setIgnoreMouseEvents(!on, { forward: true });
  } catch {
    //
  }
  if (on) {
    try {
      const level = process.platform === 'darwin' ? 'floating' : 'screen-saver';
      overlayWin.setAlwaysOnTop(true, level);
    } catch {
      //
    }
    // 不主动 focus/show，避免激活应用后把主窗口抬到最前
  }
}

export function isRewriteOverlayVisible(): boolean {
  if (!overlayWin || overlayWin.isDestroyed()) return false;
  try {
    return overlayWin.isVisible();
  } catch {
    return false;
  }
}
