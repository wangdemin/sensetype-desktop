export function canStreamInsertInFocusedWindow(options: {
  autoInsert: boolean;
  shouldRecordOnly?: boolean;
}): boolean {
  const { autoInsert, shouldRecordOnly = false } = options;
  try {
    if (!autoInsert) return false;
    if (shouldRecordOnly) return false;
    if (!document.hasFocus()) return false;
    const el = document.activeElement as any;
    const isTextInput =
      el instanceof HTMLInputElement ||
      el instanceof HTMLTextAreaElement ||
      (typeof el?.tagName === 'string' &&
        (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea'));
    return Boolean(isTextInput || el?.isContentEditable);
  } catch {
    return false;
  }
}

export async function injectTextToExternal(options: {
  ipcRenderer: any;
  text: string;
  isWin: boolean;
  normalizeText: (text: string) => string;
}): Promise<boolean> {
  const { ipcRenderer, text, isWin, normalizeText } = options;
  const externalText = normalizeText(text);
  if (!externalText) return false;
  if (isWin) {
    await ipcRenderer?.invoke('inject-text', externalText);
    return true;
  }
  try {
    await ipcRenderer?.invoke('inject-text', externalText);
    return true;
  } catch {
    await ipcRenderer?.invoke('paste-text', externalText);
    return true;
  }
}
