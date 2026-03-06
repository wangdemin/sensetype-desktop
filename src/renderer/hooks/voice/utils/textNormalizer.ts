export function stripAllNewlines(text: string): string {
  try {
    return String(text ?? '').replace(/[ \t\u00A0]*(\r\n|\r|\n)[ \t\u00A0]*/g, '');
  } catch {
    return String(text ?? '');
  }
}

export function normalizeTextForExternalInsert(text: string): string {
  try {
    return stripAllNewlines(String(text ?? ''));
  } catch {
    return stripAllNewlines(String(text ?? ''));
  }
}

export function validateRewriteSelectedText(options: {
  text: string;
  maxLen: number;
  onTooLong: (message: string) => void;
}): string {
  const { text, maxLen, onTooLong } = options;
  const t = String(text || '').trim();
  if (!t) return '';
  if (t.length <= maxLen) return t;
  onTooLong(`选中内容过长，最大支持${maxLen}字长度`);
  return '';
}
