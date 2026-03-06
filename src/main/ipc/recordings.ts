import { BrowserWindow, dialog, ipcMain } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { getRecordingSaveDir, setRecordingSaveDir } from '../common/settingsStore';

function safeFileBaseName(raw: unknown): string {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return '';
  // allow only simple chars to avoid path traversal / weird filenames
  return s.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80);
}

function resolveRecordingDirFromPicked(rootDir: string): string {
  // 为了“一键清理”安全起见：始终使用应用专属子目录，避免误删用户目录内其他文件
  return path.join(rootDir, 'SenseType Recordings');
}

function normalizeDir(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  if (!s) return null;
  return s;
}

export function registerRecordingsHandlers() {
  ipcMain.handle('settings-get-recording-save-dir', async () => {
    return { dir: getRecordingSaveDir() };
  });

  ipcMain.handle('settings-set-recording-save-dir', async (_event, payload: unknown) => {
    const dir = (payload as any)?.dir;
    const next = setRecordingSaveDir(dir);
    return { dir: next };
  });

  ipcMain.handle('settings-choose-recording-save-dir', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    const opts = {
      title: '选择录音保存目录',
      properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[],
    };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    if (res.canceled) return { dir: getRecordingSaveDir(), canceled: true };
    const picked = Array.isArray(res.filePaths) ? res.filePaths[0] : '';
    const rootDir = normalizeDir(picked);
    if (!rootDir) return { dir: getRecordingSaveDir(), canceled: true };
    const appDir = resolveRecordingDirFromPicked(rootDir);
    const next = setRecordingSaveDir(appDir);
    try {
      if (next) await fs.mkdir(next, { recursive: true });
    } catch {
      // ignore: mkdir failure will be handled during save
    }
    return { dir: next, canceled: false };
  });

  ipcMain.handle(
    'recordings-save-mp3',
    async (
      _event,
      payload: {
        bytes?: ArrayBuffer | Uint8Array | number[];
        fileBaseName?: string;
        meta?: unknown;
      },
    ) => {
      try {
        const dir = getRecordingSaveDir();
        if (!dir) return { success: false, skipped: true, reason: 'disabled' };

        let buf: Buffer | null = null;
        const b = payload?.bytes as any;
        if (b instanceof Uint8Array) buf = Buffer.from(b);
        else if (b instanceof ArrayBuffer) buf = Buffer.from(new Uint8Array(b));
        else if (Array.isArray(b)) buf = Buffer.from(b);
        if (!buf || buf.length === 0)
          return { success: false, skipped: true, reason: 'missing-bytes' };

        await fs.mkdir(dir, { recursive: true });

        const base = safeFileBaseName(payload?.fileBaseName) || 'recording';
        const ts = new Date();
        const stamp = [
          ts.getFullYear(),
          String(ts.getMonth() + 1).padStart(2, '0'),
          String(ts.getDate()).padStart(2, '0'),
          '_',
          String(ts.getHours()).padStart(2, '0'),
          String(ts.getMinutes()).padStart(2, '0'),
          String(ts.getSeconds()).padStart(2, '0'),
        ].join('');
        const rand = crypto.randomBytes(3).toString('hex');
        const fileName = `sensetype_${base}_${stamp}_${rand}.mp3`;
        const filePath = path.join(dir, fileName);

        await fs.writeFile(filePath, buf);

        return { success: true, filePath, fileName, bytes: buf.length, dir };
      } catch (e) {
        const err = e instanceof Error ? e : new Error(String(e));
        return { success: false, error: err.message };
      }
    },
  );

  ipcMain.handle('recordings-clear-saved', async () => {
    try {
      const dir = getRecordingSaveDir();
      if (!dir) return { success: false, skipped: true, reason: 'disabled' };

      let entries: any[] = [];
      try {
        entries = (await fs.readdir(dir, { withFileTypes: true })) as any[];
      } catch {
        return { success: true, clearedFiles: 0, dir };
      }

      const results: number[] = await Promise.all(
        entries.map(async (ent) => {
          const name = typeof ent?.name === 'string' ? ent.name : '';
          if (!name) return 0;
          const p = path.join(dir, name);
          try {
            if (ent?.isDirectory?.()) {
              await fs.rm(p, { recursive: true, force: true });
              return 1 as number;
            }
            await fs.rm(p, { force: true });
            return 1 as number;
          } catch {
            // ignore per-entry failure
            return 0;
          }
        }),
      );
      const clearedFiles = results.reduce((sum: number, n: number) => sum + n, 0);

      return { success: true, clearedFiles, dir };
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e));
      return { success: false, error: err.message };
    }
  });
}
