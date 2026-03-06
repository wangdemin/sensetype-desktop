export function insertIntoFocusedEditableInThisWindow(text: string): boolean {
  if (!document.hasFocus()) return false;
  const el = document.activeElement as any;
  if (!el) return false;

  const isTextInput =
    el instanceof HTMLInputElement ||
    el instanceof HTMLTextAreaElement ||
    (typeof el?.tagName === 'string' &&
      (el.tagName.toLowerCase() === 'input' || el.tagName.toLowerCase() === 'textarea'));

  if (isTextInput) {
    const start = typeof el.selectionStart === 'number' ? el.selectionStart : (el.value?.length ?? 0);
    const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
    const value = typeof el.value === 'string' ? el.value : '';
    const nextValue = value.slice(0, start) + text + value.slice(end);
    try {
      const proto = Object.getPrototypeOf(el) as any;
      const desc = proto ? Object.getOwnPropertyDescriptor(proto, 'value') : undefined;
      const setter = desc?.set as ((v: string) => void) | undefined;
      if (typeof setter === 'function') setter.call(el, nextValue);
      else el.value = nextValue;
    } catch {
      el.value = nextValue;
    }

    if (typeof el.setSelectionRange === 'function') {
      const pos = start + text.length;
      el.setSelectionRange(pos, pos);
    }
    try {
      const evt = new InputEvent('input', {
        bubbles: true,
        data: text,
        inputType: 'insertText',
      });
      el.dispatchEvent(evt);
    } catch {
      el.dispatchEvent(new Event('input', { bubbles: true }));
    }
    return true;
  }

  if (el?.isContentEditable) {
    try {
      document.execCommand('insertText', false, text);
      return true;
    } catch {
      return false;
    }
  }

  return false;
}

export function getSelectedTextInFocusedTextInputInThisWindow(): string {
  if (!document.hasFocus()) return '';
  const el = document.activeElement as unknown as {
    selectionStart?: unknown;
    selectionEnd?: unknown;
    value?: unknown;
    tagName?: unknown;
  } | null;
  if (!el) return '';

  const tag = typeof el.tagName === 'string' ? el.tagName.toLowerCase() : '';
  const isTextInput = tag === 'input' || tag === 'textarea';
  if (!isTextInput) return '';

  const value = typeof el.value === 'string' ? el.value : '';
  const start = typeof el.selectionStart === 'number' ? el.selectionStart : 0;
  const end = typeof el.selectionEnd === 'number' ? el.selectionEnd : start;
  if (end <= start) return '';
  return value.slice(start, end);
}

export function getSelectedTextInThisWindow(): string {
  try {
    if (!document.hasFocus()) return '';
    const inInput = getSelectedTextInFocusedTextInputInThisWindow();
    if (inInput && inInput.trim()) return inInput;
    const sel = window.getSelection?.();
    const text = sel?.toString?.() || '';
    return text && text.trim() ? text : '';
  } catch {
    return '';
  }
}
