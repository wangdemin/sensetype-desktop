import { clipboard } from 'electron';
import { spawn } from 'child_process';

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

// 串行化所有“写剪贴板→粘贴→恢复”的操作，避免并发互相覆盖剪贴板导致粘贴错内容
let pasteQueue: Promise<void> = Promise.resolve();

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

async function simulatePasteShortcut() {
  await runCommand('osascript', [
    '-e',
    'tell application "System Events" to keystroke "v" using {command down}',
  ]);
}

async function pasteOnce(text: string) {
  const previousText = clipboard.readText();
  try {
    clipboard.writeText(text);
    // 给系统一点时间更新剪贴板（30ms 在部分机器/应用上可能不够）
    await sleep(60);
    await simulatePasteShortcut();
    // 关键：粘贴快捷键可能是“排队异步”送达的，太快恢复会导致粘贴到旧剪贴板内容
    await sleep(220);
  } finally {
    // 尽量恢复用户剪贴板
    clipboard.writeText(previousText);
  }
}

export async function pasteTextToActiveApp(text: string) {
  pasteQueue = pasteQueue.then(() => pasteOnce(String(text ?? '')));
  return pasteQueue;
}
