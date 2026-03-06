import { Menu, Tray, BrowserWindow, nativeImage, app } from 'electron';
import pkg from '../../../package.json';
import { getIconPath } from '../common/getIconPath';
import {
  hideTrayMenuWindow,
  initTrayMenuWindow,
  toggleTrayMenuWindow,
} from '../common/trayMenuWindow';

type WindowGetter = {
  getWindow: () => BrowserWindow | undefined;
  getLoginWindow: () => BrowserWindow | null;
  getOrCreateWindow?: () => BrowserWindow;
  // Called before showing any window via tray click (used for self-heal like hotkey re-init)
  onBeforeShow?: () => void;
};

function createTray(windowGetter: WindowGetter): Promise<Tray> {
  return new Promise((resolve) => {
    // 托盘图标：与登录窗口/主窗口保持一致（统一走 getIconPath）
    const iconPath = getIconPath();
    const image = nativeImage.createFromPath(iconPath);
    const finalImage =
      process.platform === 'darwin' ? image.resize({ width: 16, height: 16 }) : image;

    if (image.isEmpty()) {
      console.warn('托盘图标加载失败（image.isEmpty），iconPath:', iconPath);
    } else {
      console.log('托盘图标路径:', iconPath);
    }

    const appIcon = new Tray(finalImage);
    // 注意：logo_icon.png 是彩色图标，mac 上不强制 template，否则可能显示/点击异常
    appIcon.setToolTip('SenseAudio AI语音输入法');

    // 显示窗口的函数：优先显示登录窗口，否则显示主窗口
    const showWindow = () => {
      try {
        const loginWin = windowGetter.getLoginWindow();
        const mainWin = windowGetter.getWindow();

        // 优先显示登录窗口（如果存在且未销毁）
        if (loginWin && !loginWin.isDestroyed()) {
          loginWin.show();
          loginWin.focus();
          return;
        }

        // 否则显示主窗口（如果存在且未销毁）
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.show();
          mainWin.focus();
          return;
        }

        // 如果主窗口不存在或已销毁，尝试重新创建
        console.log('[Tray] 窗口不存在，尝试重新创建...');
        if (windowGetter.getOrCreateWindow) {
          const newWin = windowGetter.getOrCreateWindow();
          if (newWin && !newWin.isDestroyed()) {
            newWin.show();
            newWin.focus();
          } else {
            console.warn('[Tray] 创建窗口失败');
          }
        } else {
          console.warn('[Tray] 无法重新创建窗口（getOrCreateWindow 不可用）');
        }
      } catch (error) {
        console.error('[Tray] 显示窗口时出错:', error);
      }
    };

    // 跳转到“检查更新”页面（About）
    const jumpToCheckUpdate = () => {
      try {
        windowGetter.onBeforeShow?.();
      } catch (e) {
        console.warn('[Tray] onBeforeShow failed:', e);
      }
      showWindow();
      try {
        const mainWin = windowGetter.getWindow() ?? windowGetter.getOrCreateWindow?.();
        if (mainWin && !mainWin.isDestroyed()) {
          mainWin.webContents.send('app-navigate', { page: 'about' });
        }
      } catch (error) {
        console.warn('[Tray] Failed to navigate to update page:', error);
      }
    };

    // 初始化“自定义托盘菜单窗口”（只需一次；内部做了幂等）
    try {
      initTrayMenuWindow({
        onBeforeShow: windowGetter.onBeforeShow,
        showMainWindow: () => showWindow(),
        hideMainWindow: () => {
          try {
            const mainWin = windowGetter.getWindow();
            if (mainWin && !mainWin.isDestroyed()) mainWin.hide();
          } catch {
            // ignore
          }
        },
        navigate: (page) => {
          try {
            const mainWin = windowGetter.getWindow() ?? windowGetter.getOrCreateWindow?.();
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.webContents.send('app-navigate', { page });
            }
          } catch {
            // ignore
          }
        },
        checkUpdate: () => {
          try {
            const mainWin = windowGetter.getWindow() ?? windowGetter.getOrCreateWindow?.();
            if (mainWin && !mainWin.isDestroyed()) {
              mainWin.webContents.send('app-check-update', { source: 'tray' });
            }
          } catch {
            // ignore
          }
        },
        quit: () => {
          try {
            app.quit();
          } finally {
            // mac：有些窗口 close 会 preventDefault，可能导致 quit 卡住；这里做强制退出兜底
            if (process.platform === 'darwin') {
              setTimeout(() => {
                try {
                  app.exit(0);
                } catch {
                  // ignore
                }
              }, 2500);
            }
          }
        },
      });
    } catch {
      // ignore
    }

    // 检查当前是否应该显示菜单（只在主窗口时显示）
    const shouldShowMenu = (): boolean => {
      const loginWin = windowGetter.getLoginWindow();
      const mainWin = windowGetter.getWindow();

      // 如果登录窗口存在且可见，不显示菜单
      if (loginWin && !loginWin.isDestroyed() && loginWin.isVisible()) {
        return false;
      }

      // 如果主窗口存在，显示菜单
      if (mainWin && !mainWin.isDestroyed()) {
        return true;
      }

      // 默认不显示菜单
      return false;
    };

    // 构建菜单
    const buildMenu = () => {
      return Menu.buildFromTemplate([
        {
          label: '显示AI语音输入法',
          click() {
            showWindow();
          },
        },
        { type: 'separator' },
        {
          label: '版本: ' + pkg.version,
          enabled: false,
        },
        { type: 'separator' },
        {
          label: '检查更新',
          click() {
            jumpToCheckUpdate();
          },
        },
        { type: 'separator' },
        {
          label: '退出AI语音输入法',
          click() {
            app.quit();
          },
        },
      ]);
    };

    // mac：左键显示窗口，右键弹菜单（同时用 mouse-up 兜底一些设备/系统不触发 right-click 的情况）
    // win/linux：同样左键显示窗口，右键弹菜单
    const clickHandler = () => {
      if (appIcon.isDestroyed()) return;
      try {
        windowGetter.onBeforeShow?.();
      } catch (e) {
        console.warn('[Tray] onBeforeShow failed:', e);
      }
      // 点击托盘图标时：如果自定义菜单开着，先收起
      try {
        hideTrayMenuWindow();
      } catch {
        // ignore
      }
      showWindow();
    };
    const rightClickHandler = () => {
      if (appIcon.isDestroyed()) return;
      // 只在主窗口阶段显示菜单
      if (!shouldShowMenu()) return;
      try {
        toggleTrayMenuWindow(appIcon);
      } catch {
        // 兜底：若自定义菜单异常，则退回系统菜单
        appIcon.popUpContextMenu(buildMenu());
      }
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const mouseUpHandler = (event: any) => {
      if (appIcon.isDestroyed()) return;
      // button === 2 通常为右键
      if (event?.button === 2) {
        if (!shouldShowMenu()) return;
        try {
          toggleTrayMenuWindow(appIcon);
        } catch {
          appIcon.popUpContextMenu(buildMenu());
        }
      }
    };

    appIcon.on('click', clickHandler);
    appIcon.on('right-click', rightClickHandler);
    appIcon.on('mouse-up', mouseUpHandler);

    resolve(appIcon);
  });
}

export default createTray;
