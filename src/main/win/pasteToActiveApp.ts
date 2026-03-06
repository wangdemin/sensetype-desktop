import { clipboard } from 'electron';
import { loadKeyhookOrThrow } from './keyhookLoader';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 串行化所有“写剪贴板→粘贴→恢复”的操作，避免并发互相覆盖剪贴板导致粘贴错内容
let pasteQueue: Promise<void> = Promise.resolve();

async function simulatePasteShortcut() {
  const keyhook = loadKeyhookOrThrow<{ sendPaste?: () => boolean }>();
  if (typeof keyhook.sendPaste !== 'function') {
    throw new Error('native keyhook.sendPaste() is not available');
  }
  const ok = keyhook.sendPaste();
  if (!ok) throw new Error('native keyhook.sendPaste() failed');
}

async function pasteOnce(text: string) {
  const previousText = clipboard.readText();
  try {
    clipboard.writeText(text);
    await sleep(60);
    await simulatePasteShortcut();
    // 同 mac：避免粘贴快捷键延迟送达导致粘贴到恢复后的旧剪贴板
    await sleep(220);
  } finally {
    clipboard.writeText(previousText);
  }
}

export async function pasteTextToActiveApp(text: string) {
  pasteQueue = pasteQueue.then(() => pasteOnce(String(text ?? '')));
  return pasteQueue;
}
