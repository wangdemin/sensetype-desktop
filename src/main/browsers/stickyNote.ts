import { BrowserWindow, ipcMain, shell, app, screen } from 'electron';
import path, { join } from 'path';
import { enable } from '@electron/remote/main';

const stickyWindows = new Map<BrowserWindow, string | undefined>();

function broadcastStickyNoteState(id: string, isOpen: boolean) {
  try {
    for (const w of BrowserWindow.getAllWindows()) {
      if (!w || w.isDestroyed()) continue;
      w.webContents.send('sticky-note-state-change', { id, isOpen });
    }
  } catch {
    // ignore
  }
}

export function createStickyNoteWindow(
  arg: string | { type?: string; id?: string; content?: string },
) {
  // 检查是否已存在相同 ID 的窗口
  let targetId: string | undefined;
  if (typeof arg !== 'string' && arg.id) {
    targetId = String(arg.id);
  }

  if (targetId) {
    for (const [win, id] of stickyWindows.entries()) {
      if (win.isDestroyed()) continue;
      if (id === targetId) {
        if (win.isMinimized()) win.restore();
        win.focus();
        broadcastStickyNoteState(targetId, true);
        return;
      }
    }
  }

  // 允许创建多个便签窗口，不再强制单例
  const win = new BrowserWindow({
    width: 320,
    height: 320,
    minWidth: 200,
    minHeight: 150,
    frame: false, // 无边框
    alwaysOnTop: true, // 置顶
    transparent: true, // 开启透明
    skipTaskbar: false, // 显示在任务栏
    resizable: true,
    backgroundColor: '#00000000', // 背景全透明
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      webSecurity: false,
      preload: app.isPackaged
        ? path.join(__dirname, '../../dist/preload.js')
        : path.join(__dirname, '../../public/preload.js'),
    },
  });
  //win.webContents.openDevTools({ mode: 'detach' });
  enable(win.webContents);
  stickyWindows.set(win, targetId);
  // Windows：使用 screen-saver 层级确保贴到屏幕的窗口在所有程序最前
  if (process.platform === 'win32') {
    try {
      win.setAlwaysOnTop(true, 'screen-saver');
    } catch {
      // ignore
    }
  }
  if (targetId) {
    broadcastStickyNoteState(targetId, true);
  }

  const urlPath = '/sticky-note';

  const params = new URLSearchParams();
  if (typeof arg === 'string') {
    const safeContent = arg.length > 2000 ? arg.slice(0, 2000) + '...' : arg;
    params.append('content', safeContent);
  } else {
    if (arg.type) params.append('type', arg.type);
    if (arg.id) params.append('id', arg.id);
    if (arg.content) {
      const safeContent =
        arg.content.length > 2000 ? arg.content.slice(0, 2000) + '...' : arg.content;
      params.append('content', safeContent);
    }
  }

  const search = params.toString();

  if (process.env.VITE_DEV_SERVER_URL) {
    const url = `${process.env.VITE_DEV_SERVER_URL}/#${urlPath}?${search}`;
    win.loadURL(url);
  } else {
    //  HashRouter 要求查询参数必须包含在哈希值中。
    win.loadFile(join(__dirname, '../../dist/index.html'), {
      hash: search ? `${urlPath}?${search}` : urlPath,
    });
  }

  // 处理外部链接
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('http')) {
      shell.openExternal(url);
    }
    return { action: 'deny' };
  });

  win.on('closed', () => {
    stickyWindows.delete(win);
    if (targetId) {
      broadcastStickyNoteState(targetId, false);
    }
  });

  // 窗口首次显示时再次置顶并移到最前，避免被其它程序挡住
  win.once('ready-to-show', () => {
    if (win.isDestroyed()) return;
    if (process.platform === 'win32') {
      try {
        win.setAlwaysOnTop(true, 'screen-saver');
        win.moveTop();
      } catch {
        // ignore
      }
    }
  });
}

export function setupStickyNoteIpc() {
  ipcMain.on('create-sticky-note', (_event, arg) => {
    createStickyNoteWindow(arg);
  });

  ipcMain.handle('get-open-sticky-notes', () => {
    const ids: string[] = [];
    for (const id of stickyWindows.values()) {
      if (id) ids.push(id);
    }
    return ids;
  });

  // 便签窗口内的数据变更（note/todo）后，通知其他窗口刷新列表
  ipcMain.on('notes-data-changed', (event, payload: { kind?: unknown }) => {
    try {
      const kind = typeof payload?.kind === 'string' ? payload.kind : 'all';
      for (const w of BrowserWindow.getAllWindows()) {
        try {
          if (!w || w.isDestroyed()) continue;
          // 不回发给触发方窗口（避免重复刷新/自回环）
          if (w.webContents === event.sender) continue;
          w.webContents.send('notes-data-changed', { kind });
        } catch {
          // ignore
        }
      }
    } catch {
      // ignore
    }
  });

  ipcMain.on('resize-sticky-note', (event, height: number) => {
    try {
      const win = BrowserWindow.fromWebContents(event.sender);
      if (win && !win.isDestroyed()) {
        const [width] = win.getSize();

        // 获取当前窗口所在屏幕
        const currentScreen = screen.getDisplayNearestPoint(win.getBounds());
        // 限制最大高度为屏幕工作区高度的 90%
        const maxHeight = Math.floor(currentScreen.workAreaSize.height * 0.9);

        // 确保高度在合理范围内：最小 150，最大 maxHeight
        const newHeight = Math.min(Math.max(height, 150), maxHeight);

        const bounds = win.getBounds();
        // 只有当高度变化超过一定阈值（例如 2px）时才调整，避免抖动
        if (Math.abs(bounds.height - newHeight) > 2) {
          win.setBounds({
            x: bounds.x,
            y: bounds.y,
            width: width,
            height: newHeight,
          });
        }
      }
    } catch (error) {
      console.error('Failed to resize sticky note window:', error);
    }
  });
}
