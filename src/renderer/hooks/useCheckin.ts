import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getCheckinMonth, postCheckinRemedy } from '@/services/checkin';
import type { CheckinRemedyRequest } from '@/services/checkin/types';
import { getToken } from '@/utils/auth';
import { useCheckinStore } from '@/renderer/store/useCheckinStore';
import { useUserStore } from '@/renderer/store/useUserStore';

export type CheckinStats = {
  /** 连续签到天数 */
  streak: number;
  /** 累计签到天数 */
  total: number;
  /** 本月签到天数（按 viewMonth 月份统计） */
  monthTotal: number;
  /** 今日是否已签到 */
  todayChecked: boolean;
};

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function isFutureMonth(monthStart: Date): boolean {
  return monthStart.getTime() > startOfMonth(new Date()).getTime();
}

function normalizeCheckedDatesFromMonthDays(days: unknown, monthStart: Date): Set<string> {
  if (!Array.isArray(days)) return new Set<string>();

  const year = monthStart.getFullYear();
  const month = monthStart.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthText = String(month).padStart(2, '0');
  const result = new Set<string>();

  for (const d of days) {
    if (typeof d !== 'number' || !Number.isInteger(d)) continue;
    if (d < 1 || d > daysInMonth) continue;
    result.add(`${year}-${monthText}-${String(d).padStart(2, '0')}`);
  }

  return result;
}

export function useCheckin(viewMonth: Date) {
  const hasToken = Boolean(String(getToken() || '').trim());
  const userIdentityKey = useUserStore((s) => {
    const u = (s.userInfo ?? null) as Record<string, unknown> | null;
    // 账号切换时，用稳定身份键触发 reload；避免“有 token 但账号已变更”不刷新。
    return String(
      u?.user_id ?? u?.uid ?? u?.id ?? u?.phone ?? u?.mobile ?? u?.username ?? '',
    ).trim();
  });
  const monthStart = useMemo(() => startOfMonth(viewMonth), [viewMonth]);
  const requestIdRef = useRef(0);

  const [checkedDates, setCheckedDates] = useState<Set<string>>(() => new Set());
  const [stats, setStats] = useState<CheckinStats>(() => ({
    streak: 0,
    total: 0,
    monthTotal: 0,
    todayChecked: false,
  }));
  // 剩余免费补签次数
  const [freeRemedyNums, setFreeRemedyNums] = useState<number>(0);
  // 当前签到天数
  const [countCheckinDays, setCountCheckinDays] = useState<number>(0);
  // 已领取的里程碑天数
  const [claimedMilestones, setClaimedMilestones] = useState<number[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const setTodayCheckin = useCheckinStore((s) => s.setTodayCheckin);
  const calendarRefreshVersion = useCheckinStore((s) => s.calendarRefreshVersion);

  const reload = useCallback(async () => {
    if (!hasToken) {
      setLoading(false);
      setCheckedDates(new Set());
      setStats({
        streak: 0,
        total: 0,
        monthTotal: 0,
        todayChecked: false,
      });
      setFreeRemedyNums(0);
      setCountCheckinDays(0);
      setClaimedMilestones([]);
      return;
    }
    if (isFutureMonth(monthStart)) {
      setLoading(false);
      setCheckedDates(new Set());
      setStats({
        streak: 0,
        total: 0,
        monthTotal: 0,
        todayChecked: false,
      });
      setFreeRemedyNums(0);
      setCountCheckinDays(0);
      setClaimedMilestones([]);
      return;
    }

    const requestId = ++requestIdRef.current;
    setLoading(true);
    setCheckedDates(new Set<string>());
    setCountCheckinDays(0);
    setClaimedMilestones([]);

    let currentResult: {
      data: Set<string>;
      count: number;
      freeRemedyNums: number;
      claimedMilestones: number[];
    } | null = null;
    try {
      const resp = await getCheckinMonth({
        year: monthStart.getFullYear(),
        month: monthStart.getMonth() + 1,
      });

      if (resp.success) {
        console.log('getCheckinMonth', resp);
        currentResult = {
          data: normalizeCheckedDatesFromMonthDays(resp.data.is_checkin, monthStart),
          count: resp.data.count_checkin_days,
          freeRemedyNums: resp.data.free_remedy_nums ?? 0,
          claimedMilestones: resp.data.count_checkin_finish_days ?? [],
        };
        setTodayCheckin(Boolean(resp.data.today_checkin));
      }
    } catch {
      currentResult = null;
    }

    // 检查请求是否过期
    if (requestId !== requestIdRef.current) return;
    setLoading(false);

    // 更新当前月份的状态
    if (currentResult) {
      const todayKey = formatYmd(new Date());
      const monthCheckedCount =
        typeof currentResult.count === 'number' ? currentResult.count : currentResult.data.size;

      setCheckedDates(currentResult.data);
      setStats({
        streak: 0,
        total: monthCheckedCount,
        monthTotal: monthCheckedCount,
        todayChecked: currentResult.data.has(todayKey),
      });
      // 更新免费补签次数
      setFreeRemedyNums(currentResult.freeRemedyNums);
      // 更新签到天数和已领取里程碑
      setCountCheckinDays(monthCheckedCount);
      setClaimedMilestones(currentResult.claimedMilestones);
    } else {
      setCheckedDates(new Set<string>());
      setStats({
        streak: 0,
        total: 0,
        monthTotal: 0,
        todayChecked: false,
      });
      setFreeRemedyNums(0);
      setCountCheckinDays(0);
      setClaimedMilestones([]);
    }
  }, [hasToken, monthStart, setTodayCheckin, userIdentityKey]);

  useEffect(() => {
    void reload();
  }, [calendarRefreshVersion, reload]);

  const remedyCheckin = useCallback(
    async (params: CheckinRemedyRequest): Promise<boolean> => {
      if (!hasToken) return false;
      try {
        const resp = await postCheckinRemedy(params);
        console.log(resp, 'respddddd');
        if (!resp.success) return false;
      } catch (error: any) {
        return error;
      }
      await reload();
      return true;
    },
    [hasToken, reload],
  );

  return {
    checkedDates,
    stats,
    reload,
    remedyCheckin,
    freeRemedyNums,
    countCheckinDays,
    claimedMilestones,
    loading,
  };
}
