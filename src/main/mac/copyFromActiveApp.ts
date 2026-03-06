import { clipboard } from 'electron';
import { spawn } from 'child_process';
import { tryLoadKeyhook } from './keyhookLoader';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function runCommand(command: string, args: string[], timeoutMs = 1500) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: 'ignore' });
    const t = setTimeout(() => {
      try {
        child.kill();
      } catch {
        //
      }
      reject(new Error(`${command} timed out after ${timeoutMs}ms`));
    }, timeoutMs);
    child.on('error', reject);
    child.on('exit', (code) => {
      clearTimeout(t);
      if (code === 0) resolve();
      else reject(new Error(`${command} exited with code ${code}`));
    });
  });
}

async function simulateCopyShortcut() {
  // Fast path: use native CGEvent (avoids osascript, and avoids Option+Cmd+C inspect issues)
  try {
    const keyhook = tryLoadKeyhook<{ sendCopy?: () => boolean }>();
    if (typeof keyhook?.sendCopy === 'function') {
      const ok = keyhook.sendCopy();
      if (ok) return;
    }
  } catch {
    // ignore and fallback
  }
  await runCommand('osascript', [
    '-e',
    'tell application "System Events" to keystroke "c" using {command down}',
  ]);
}

/**
 * macOS：读取"当前前台应用"的选中文本（跨应用）。
 *
 * 原理：临时写入剪贴板 marker → 发送 Cmd+C → 读取剪贴板 → 恢复用户剪贴板
 *
 * - 若没有选区/拷贝失败，返回空字符串
 * - 需要 macOS 辅助功能权限（与 paste 同级）
 */
export async function readSelectedTextFromActiveApp(): Promise<string> {
  const previousText = clipboard.readText();
  // 用 marker 避免"选中文本恰好等于原剪贴板"导致无法判断
  const marker = `__SENSETYPE_SELECTION_MARKER__${Date.now()}_${Math.random()}`;
  try {
    clipboard.writeText(marker);
    await sleep(30);
    await simulateCopyShortcut();
    // 给系统一点时间更新剪贴板（浏览器/重应用可能更慢）
    await sleep(80);
    const copied = clipboard.readText();
    if (!copied || copied === marker) return '';
    return copied;
  } finally {
    await sleep(30);
    clipboard.writeText(previousText);
  }
}
