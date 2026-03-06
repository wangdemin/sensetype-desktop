import { clipboard } from 'electron';
import { loadKeyhookOrThrow } from './keyhookLoader';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function waitForHoldKeyReleaseBeforeCopy(maxWaitMs = 260): Promise<boolean> {
  // Avoid sending Ctrl+C while the user is physically holding Right Alt (PTT key),
  // otherwise some apps can occasionally observe Ctrl+Alt+C.
  const keyhook = loadKeyhookOrThrow<{ isHoldDown?: () => boolean }>();
  if (typeof keyhook.isHoldDown !== 'function') {
    throw new Error('native keyhook.isHoldDown() is not available');
  }
  const startedAt = Date.now();
  while (Date.now() - startedAt < maxWaitMs) {
    const down = !!keyhook.isHoldDown();
    if (!down) {
      // Give the OS a tiny settle window for AltGr implicit modifier state.
      await sleep(24);
      return true;
    }
    await sleep(16);
  }
  return false;
}

async function simulateCopyShortcut() {
  const keyhook = loadKeyhookOrThrow<{ sendCopy?: () => boolean }>();
  if (typeof keyhook.sendCopy !== 'function') {
    throw new Error('native keyhook.sendCopy() is not available');
  }
  const ok = keyhook.sendCopy();
  if (!ok) throw new Error('native keyhook.sendCopy() failed');
}

/**
 * Windows：读取"当前前台应用"的选中文本（跨应用）。
 *
 * 原理：临时写入剪贴板 marker → 发送 Ctrl+C → 读取剪贴板 → 恢复用户剪贴板
 */
export async function readSelectedTextFromActiveApp(): Promise<string> {
  const safeToCopy = await waitForHoldKeyReleaseBeforeCopy();
  if (!safeToCopy) return '';

  const previousText = clipboard.readText();
  const marker = `__SENSETYPE_SELECTION_MARKER__${Date.now()}_${Math.random()}`;
  try {
    clipboard.writeText(marker);
    await sleep(30);
    await simulateCopyShortcut();
    await sleep(80);
    const copied = clipboard.readText();
    if (!copied || copied === marker) return '';
    return copied;
  } finally {
    await sleep(30);
    clipboard.writeText(previousText);
  }
}
