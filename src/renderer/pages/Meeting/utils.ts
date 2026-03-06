import type { MeetingRecord } from '@/services/meeting/types';
import type { MeetingItem } from './list';

function formatDuration(seconds: number): string {
  if (seconds == null || typeof seconds !== 'number' || isNaN(seconds)) {
    return '00:00:00';
  }

  const totalSeconds = Math.floor(seconds);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const secs = totalSeconds % 60;
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function formatDate(timestamp: number): string {
  if (timestamp == null || typeof timestamp !== 'number' || isNaN(timestamp)) {
    return '--';
  }

  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${year}.${month}.${day} ${hours}:${minutes}`;
}

export function convertToMeetingItem(record: MeetingRecord): MeetingItem {
  return {
    id: record.id,
    title: record.title,
    duration: formatDuration(record.duration),
    date: formatDate(record.created_at),
  };
}

export function getErrorMessage(err: unknown, fallback: string): string {
  const e = err as any;
  return e?.response?.data?.message ?? e?.error?.response?.data?.message ?? e?.message ?? fallback;
}
