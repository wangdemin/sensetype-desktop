export type AvatarInfo = {
  fileUrl: string;
  updatedAt: number;
  filePath?: string;
};

export const AVATAR_UPDATED_EVENT = 'sensetype-avatar-updated';

export type AvatarUpdatedDetail = {
  userKey: string;
  fileUrl?: string | null;
  updatedAt?: number;
};

type IpcRendererLike = {
  invoke?: (channel: string, ...args: any[]) => Promise<any>;
};

function getIpcRenderer(): IpcRendererLike | null {
  const fromPreload = (window as any)?.electronAPI?.ipcRenderer as IpcRendererLike | undefined;
  if (fromPreload?.invoke) return fromPreload;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { ipcRenderer } = require('electron') as { ipcRenderer?: IpcRendererLike };
    if (ipcRenderer?.invoke) return ipcRenderer;
  } catch {
    // ignore
  }
  return null;
}

export function getUserKeyFromUserInfo(userInfo: unknown): string {
  const u = (userInfo ?? null) as Record<string, unknown> | null;
  const phone = String(u?.phone ?? u?.mobile ?? u?.tel ?? '').trim();
  if (phone) return phone.replace(/[^\d+]+/g, '') || phone;
  const username = String(u?.username ?? u?.name ?? '').trim();
  if (username) return username;
  return 'guest';
}

export async function avatarGet(userKey: string): Promise<AvatarInfo | null> {
  const ipc = getIpcRenderer();
  if (!ipc?.invoke) return null;
  try {
    const res = await ipc.invoke('avatar-get', { userKey });
    if (!res || typeof res?.fileUrl !== 'string') return null;
    return {
      fileUrl: String(res.fileUrl),
      updatedAt: Number(res.updatedAt) || Date.now(),
      filePath: typeof res.filePath === 'string' ? res.filePath : undefined,
    };
  } catch {
    return null;
  }
}

export async function avatarSave(params: {
  userKey: string;
  bytes: Uint8Array;
  mimeType?: string;
}): Promise<AvatarInfo> {
  const ipc = getIpcRenderer();
  if (!ipc?.invoke) throw new Error('ipcRenderer.invoke unavailable');
  const res = await ipc.invoke('avatar-save', {
    userKey: params.userKey,
    bytes: params.bytes,
    mimeType: params.mimeType ?? 'image/png',
  });
  if (!res || typeof res?.fileUrl !== 'string') throw new Error('avatar-save failed');
  return {
    fileUrl: String(res.fileUrl),
    updatedAt: Number(res.updatedAt) || Date.now(),
    filePath: typeof res.filePath === 'string' ? res.filePath : undefined,
  };
}

export async function avatarRemove(userKey: string): Promise<void> {
  const ipc = getIpcRenderer();
  if (!ipc?.invoke) return;
  await ipc.invoke('avatar-remove', { userKey });
}

export function emitAvatarUpdated(detail: AvatarUpdatedDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(AVATAR_UPDATED_EVENT, { detail }));
  } catch {
    // ignore
  }
}

export function addAvatarUpdatedListener(
  handler: (detail: AvatarUpdatedDetail) => void,
): () => void {
  if (typeof window === 'undefined') return () => undefined;
  const listener = (event: Event) => {
    const detail = (event as CustomEvent<AvatarUpdatedDetail>).detail;
    if (detail) handler(detail);
  };
  window.addEventListener(AVATAR_UPDATED_EVENT, listener);
  return () => window.removeEventListener(AVATAR_UPDATED_EVENT, listener);
}
