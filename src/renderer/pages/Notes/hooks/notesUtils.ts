import type { NoteWithMeta } from './types';

export function toTimestamp(value: number | string | undefined): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'number') {
    return value < 10_000_000_000 ? value * 1000 : value;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parsed = Date.parse(trimmed);
  if (!Number.isNaN(parsed)) return parsed;
  const asNumber = Number(trimmed);
  if (!Number.isNaN(asNumber)) return asNumber < 10_000_000_000 ? asNumber * 1000 : asNumber;
  return null;
}

export function getNoteTimestamp(note: NoteWithMeta): number | null {
  return toTimestamp(note.updated_at) || toTimestamp(note.created_at);
}

export function formatDateTime(ts: number | null): string {
  if (!ts) return '';
  const d = new Date(ts);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(
    d.getMinutes(),
  )}`;
}

export function getErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') return '请求失败';
  const maybe = err as { error?: { message?: string } };
  return maybe.error?.message || '请求失败';
}
