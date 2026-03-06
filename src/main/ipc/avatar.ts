import { app, ipcMain } from 'electron';
import path from 'path';
import { pathToFileURL } from 'url';
import * as fs from 'fs';

type AvatarSavePayload = {
  userKey?: unknown;
  bytes?: unknown;
  mimeType?: unknown;
};

type AvatarKeyPayload = {
  userKey?: unknown;
};

function sanitizeUserKey(input: unknown): string {
  const raw = typeof input === 'string' ? input : String(input ?? '');
  const trimmed = raw.trim();
  if (!trimmed) return 'guest';
  // allow only safe characters for filenames
  const safe = trimmed.replace(/[^\w.-]+/g, '_').slice(0, 64);
  return safe || 'guest';
}

function getAvatarDir(): string {
  return path.join(app.getPath('userData'), 'avatars');
}

function buildAvatarFilePath(userKey: string): string {
  // always store as png (renderer exports png)
  return path.join(getAvatarDir(), `${userKey}.png`);
}

function withCacheBust(fileUrl: string, updatedAt: number): string {
  // Use query for cache busting; safe for file:// URLs.
  return `${fileUrl}?v=${updatedAt}`;
}

export const registerAvatarHandlers = () => {
  // Save avatar bytes to userData/avatars/<userKey>.png
  ipcMain.handle('avatar-save', async (_event, payload: AvatarSavePayload) => {
    const userKey = sanitizeUserKey(payload?.userKey);
    const bytesAny = payload?.bytes;
    const mimeType = typeof payload?.mimeType === 'string' ? payload.mimeType : 'image/png';

    let buf: Buffer;
    try {
      if (bytesAny instanceof Uint8Array) {
        buf = Buffer.from(bytesAny);
      } else if (bytesAny && typeof (bytesAny as any).buffer !== 'undefined') {
        // array-like (e.g. Buffer serialized)
        buf = Buffer.from(bytesAny as any);
      } else {
        throw new Error('Invalid bytes');
      }
    } catch {
      throw new Error('avatar-save: invalid bytes');
    }

    // hard limit (avoid writing huge files)
    const MAX_BYTES = 10 * 1024 * 1024;
    if (buf.byteLength <= 0) throw new Error('avatar-save: empty bytes');
    if (buf.byteLength > MAX_BYTES) throw new Error(`avatar-save: file too large (> ${MAX_BYTES})`);

    const dir = getAvatarDir();
    const filePath = buildAvatarFilePath(userKey);
    await fs.promises.mkdir(dir, { recursive: true });
    await fs.promises.writeFile(filePath, buf);
    const st = await fs.promises.stat(filePath);
    const updatedAt = Math.floor(st.mtimeMs || Date.now());
    const fileUrl = withCacheBust(pathToFileURL(filePath).toString(), updatedAt);
    return { filePath, fileUrl, mimeType, updatedAt };
  });

  // Get avatar URL if exists
  ipcMain.handle('avatar-get', async (_event, payload: AvatarKeyPayload) => {
    const userKey = sanitizeUserKey(payload?.userKey);
    const filePath = buildAvatarFilePath(userKey);
    try {
      const st = await fs.promises.stat(filePath);
      if (!st.isFile()) return null;
      const updatedAt = Math.floor(st.mtimeMs || Date.now());
      const fileUrl = withCacheBust(pathToFileURL(filePath).toString(), updatedAt);
      return { filePath, fileUrl, updatedAt };
    } catch {
      return null;
    }
  });

  // Remove avatar if exists
  ipcMain.handle('avatar-remove', async (_event, payload: AvatarKeyPayload) => {
    const userKey = sanitizeUserKey(payload?.userKey);
    const filePath = buildAvatarFilePath(userKey);
    try {
      await fs.promises.unlink(filePath);
    } catch {
      // ignore
    }
    return { success: true };
  });
};
