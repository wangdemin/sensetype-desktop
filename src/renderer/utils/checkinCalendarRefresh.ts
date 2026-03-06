import { useCheckinStore } from '@/renderer/store/useCheckinStore';

const DAILY_CALENDAR_REFRESH_KEY = 'sensetype_checkin_calendar_refresh_day';
let inMemoryTriggeredDay = '';

function formatDayKey(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

/**
 * Trigger Home check-in calendar reload only once per day.
 * It is used after voice/rewrite API success.
 */
export function requestCheckinCalendarRefreshOnFirstUseToday(): void {
  const today = formatDayKey(new Date());
  let alreadyTriggered = false;

  try {
    const lastTriggered = localStorage.getItem(DAILY_CALENDAR_REFRESH_KEY);
    alreadyTriggered = lastTriggered === today;
    if (!alreadyTriggered) {
      localStorage.setItem(DAILY_CALENDAR_REFRESH_KEY, today);
    }
  } catch {
    alreadyTriggered = inMemoryTriggeredDay === today;
    if (!alreadyTriggered) {
      inMemoryTriggeredDay = today;
    }
  }

  if (alreadyTriggered) return;

  try {
    useCheckinStore.getState().requestCalendarRefresh();
  } catch {
    // ignore
  }
}
