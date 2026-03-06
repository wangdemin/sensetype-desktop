import { useCallback, useMemo, useState } from 'react';
import Modal from '@/renderer/components/Modal';
import styles from './index.module.scss';
import { useCheckin } from '../../hooks/useCheckin';
import CheckInSub from '@/assets/icons/checkin/checkInSub.svg?react';
import CardReplacement from '@/assets/icons/checkin/cardReplacement.svg?react';
import ConfirmDialog from '@/renderer/components/ConfirmDialog';
import { message } from '@/renderer/components/Message';
import { useCheckinConfigStore } from '@/renderer/store/useCheckinConfigStore';
import { useUserStore } from '@/renderer/store/useUserStore';
import AvailableForPickup from '@/assets/icons/checkin/available-for-pickup.svg?react';
import Claimed from '@/assets/icons/checkin/claimed.svg?react';
import Explanation from '@/assets/icons/checkin/explanation.svg?react';
import Tooltip from '@/renderer/components/Tooltip';
import { postCheckinRemedy, postClaimMilestone, postTodayCheckin } from '@/services/checkin';
import { track } from '@/utils/posthog';
import { requestUserInfoRefresh } from '@/renderer/utils/refreshUserInfo';
import TodaySubIcon from '@/assets/icons/checkin/today-sub.svg?react';

type Props = {
  className?: string;
};

type RemedyResp = {
  success: boolean;
  data: string;
};

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function addDays(d: Date, days: number): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + days);
}

function formatMonthLabel(d: Date): string {
  try {
    return new Intl.DateTimeFormat('zh-CN', { month: 'long', year: 'numeric' }).format(d);
  } catch {
    const month = d.toLocaleString('zh-CN', { month: 'long' });
    return `${d.getFullYear()}年${month}`;
  }
}

function formatYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function formatPoints(points: number): string {
  if (points >= 10000) {
    const wan = points / 10000;
    return wan % 1 === 0 ? `${wan}万` : `${wan.toFixed(1)}万`;
  }
  return String(points);
}

function getMondayIndex(jsDay: number): number {
  // JS: Sun=0..Sat=6  ->  Mon=0..Sun=6
  return (jsDay + 6) % 7;
}

function isSameMonth(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth();
}

export default function CheckinCalendar({ className }: Props) {
  const [viewMonth, setViewMonth] = useState<Date>(() => startOfMonth(new Date()));
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [remedyTarget, setRemedyTarget] = useState<{
    year: number;
    month: number;
    day: number;
  } | null>(null);
  const [todayCheckinOpen, setTodayCheckinOpen] = useState(false);
  const [todaySubmitting, setTodaySubmitting] = useState(false);
  const [remedySubmitting, setRemedySubmitting] = useState(false);
  const [claimTarget, setClaimTarget] = useState<{ days: number; points: number } | null>(null);
  const [claimSubmitting, setClaimSubmitting] = useState(false);
  const [ruleModalOpen, setRuleModalOpen] = useState(false);

  const { checkedDates, freeRemedyNums, countCheckinDays, claimedMilestones, loading, reload } =
    useCheckin(viewMonth);
  const config = useCheckinConfigStore((s) => s.config);
  const planLevel =
    useUserStore((s) => (s.userInfo as Record<string, unknown> | null)?.plan_level) ?? 0;

  // 判断是否为会员
  const isMember = planLevel !== 0;
  const remedyPoints = config?.remedy_points ?? 0;
  const onDayPoints = config?.on_day ?? 0;
  const memberOneDayPoints = config?.member_one_day ?? 0;
  // 补签文案
  const remedyDescription = useMemo(() => {
    if (isMember) {
      if (freeRemedyNums > 0) {
        // 会员有免费次数
        return `会员用户每月可免费补签3次，您当前剩余的免费补签次数：${freeRemedyNums}次，继续补签将消耗一次免费机会。`;
      } else {
        // 会员无免费次数
        return `会员用户每月可免费补签3次，您当前剩余的免费补签次数：0次，继续补签需要${formatPoints(remedyPoints)}积分，补签后您可以获得${formatPoints(memberOneDayPoints)}积分。`;
      }
    } else {
      // 非会员
      return `补签将消耗您当前账户中的${formatPoints(remedyPoints)}积分，补签后您可获得赠送的${formatPoints(onDayPoints)}积分。`;
    }
  }, [isMember, freeRemedyNums, remedyPoints, onDayPoints, memberOneDayPoints]);

  // 今日签到文案
  const todayCheckinDescription = useMemo(() => {
    if (isMember) {
      return `签到后，您可以获得免费获得双倍奖励，共计${formatPoints(memberOneDayPoints)}积分，积分有效期30天。`;
    }
    return `签到后，您可以免费获得${formatPoints(onDayPoints)}积分，积分有效期30天。`;
  }, [isMember, memberOneDayPoints, onDayPoints]);

  const todayKey = useMemo(() => formatYmd(new Date()), []);

  const monthLabel = useMemo(() => formatMonthLabel(viewMonth), [viewMonth]);

  const cells = useMemo(() => {
    const first = startOfMonth(viewMonth);
    const offset = getMondayIndex(first.getDay());
    const start = addDays(first, -offset);
    const out: { date: Date; key: string; inMonth: boolean; isToday: boolean }[] = [];
    for (let i = 0; i < 42; i += 1) {
      const date = addDays(start, i);
      const key = formatYmd(date);
      out.push({
        date,
        key,
        inMonth:
          date.getMonth() === viewMonth.getMonth() &&
          date.getFullYear() === viewMonth.getFullYear(),
        isToday: key === todayKey,
      });
    }
    return out;
  }, [todayKey, viewMonth]);

  const onClickDate = useCallback((date: Date, key: string, inMonth: boolean, checked: boolean) => {
    if (!inMonth) return;

    // 补签规则：
    // 1) 只能补签“当前自然月”
    // 2) 不能补签“今天”
    // 3) 已签到日期不允许再次补签
    const today = new Date();
    const isToday = key === formatYmd(today);
    if (!isSameMonth(date, today) || isToday || checked || date >= today) return;

    setSelectedKey(key);
    setRemedyTarget({
      year: date.getFullYear(),
      month: date.getMonth() + 1,
      day: date.getDate(),
    });
  }, []);

  const onCancelRemedy = useCallback(() => {
    if (remedySubmitting) return;
    setRemedyTarget(null);
  }, [remedySubmitting]);

  const onConfirmRemedy = useCallback(async () => {
    if (!remedyTarget || remedySubmitting) return;

    const target = remedyTarget;
    setRemedySubmitting(true);
    try {
      const resp = (await postCheckinRemedy(target)) as RemedyResp;
      setRemedySubmitting(false);
      if (resp.success) {
        setRemedyTarget(null);
        track('retro_action_times');
        message.success('补签成功');
        requestUserInfoRefresh({ reason: 'checkin-done' });
        await reload();
        return;
      }
    } catch (error) {
      setRemedySubmitting(false);
      message.error((error as any)?.error?.response?.data?.message || '补签失败，请稍后重试！');
    }
  }, [reload, remedySubmitting, remedyTarget]);

  const onConfirmTodayCheckin = useCallback(async () => {
    if (todaySubmitting) return;

    const today = new Date();
    setTodaySubmitting(true);
    try {
      const resp = await postTodayCheckin({
        year: today.getFullYear(),
        month: today.getMonth() + 1,
        day: today.getDate(),
      });
      setTodaySubmitting(false);
      console.log(resp, '今日签到');
      if (resp.success) {
        setTodayCheckinOpen(false);
        track('today_manual_checkin');
        message.success(
          isMember
            ? `签到成功，您已获得双倍奖励，共计${formatPoints(memberOneDayPoints)}积分。`
            : `签到成功，您已获得${formatPoints(onDayPoints)}积分。`,
        );
        requestUserInfoRefresh({ reason: 'checkin-done' });
        await reload();
        return;
      }
    } catch (error) {
      setTodaySubmitting(false);
      message.error((error as any)?.error?.response?.data?.message || '签到失败，请稍后重试！');
    }
  }, [isMember, reload, todaySubmitting, memberOneDayPoints, onDayPoints]);

  // 获取当前月份的最大天数
  const maxDaysInMonth = useMemo(() => {
    const year = viewMonth.getFullYear();
    const month = viewMonth.getMonth() + 1;
    return new Date(year, month, 0).getDate();
  }, [viewMonth]);

  // 里程碑配置
  const milestones = useMemo(
    () => [
      { days: 7, points: config?.seven_day ?? 0 },
      { days: 15, points: config?.fifteen_day ?? 0 },
      { days: 25, points: config?.twenty_five_day ?? 0 },
    ],
    [config],
  );

  // 判断里程碑状态
  const getMilestoneStatus = useCallback(
    (days: number) => {
      if (countCheckinDays >= days) {
        // 达到了天数
        if (claimedMilestones.includes(days)) {
          return 'claimed'; // 已领取
        }
        return 'available'; // 可领取
      }
      return 'locked'; // 未达到
    },
    [countCheckinDays, claimedMilestones],
  );

  // 点击领取
  const onClickClaim = useCallback(
    (days: number, points: number) => {
      const status = getMilestoneStatus(days);
      if (status !== 'available') return;
      setClaimTarget({ days, points });
    },
    [getMilestoneStatus],
  );

  const onCancelClaim = useCallback(() => {
    if (claimSubmitting) return;
    setClaimTarget(null);
  }, [claimSubmitting]);

  const onConfirmClaim = useCallback(async () => {
    if (!claimTarget || claimSubmitting) return;

    const target = claimTarget;
    setClaimSubmitting(true);

    try {
      const resp = await postClaimMilestone({
        count_days: target.days,
        month: viewMonth.getMonth() + 1,
        year: viewMonth.getFullYear(),
      });
      setClaimSubmitting(false);

      if (resp.success) {
        if (target.days === 7) {
          track('reward_claim_7days');
        } else if (target.days === 15) {
          track('reward_claim_15days');
        } else if (target.days === 25) {
          track('reward_claim_25days');
        }
        setClaimTarget(null);
        message.success(`您已成功领取${formatPoints(target.points)}积分`);
        requestUserInfoRefresh({ reason: 'checkin-done' });
        await reload();
        return;
      }
    } catch (error) {
      setClaimSubmitting(false);
      message.error((error as any)?.error?.response?.data?.message || '领取失败，请稍后重试');
    }
  }, [claimTarget, claimSubmitting, reload, viewMonth]);

  return (
    <div className={`${styles.container} ${className ?? ''}`.trim()}>
      <div className={styles.header}>
        {/* <button type="button" className={styles.navBtn} aria-label="上一月" onClick={onPrev}>
          ‹
        </button> */}
        <div className={styles.monthLabel} aria-label="当前月份">
          {monthLabel}
        </div>
        {/* <button type="button" className={styles.navBtn} aria-label="下一月" onClick={onNext}>
          ›
        </button> */}
      </div>
      <div className={styles.calendarTable} aria-label="签到日历区域">
        <div className={styles.weekRow} aria-hidden="true">
          <div className={styles.weekCell}>一</div>
          <div className={styles.weekCell}>二</div>
          <div className={styles.weekCell}>三</div>
          <div className={styles.weekCell}>四</div>
          <div className={styles.weekCell}>五</div>
          <div className={styles.weekCell}>六</div>
          <div className={styles.weekCell}>日</div>
        </div>

        <div className={styles.grid} role="grid" aria-label="签到日历">
          {cells.map((c, i) => {
            const checked = checkedDates.has(c.key);
            const selected = selectedKey === c.key;

            // 判断是否可以补卡：当月 && 不是今天 && 未签到 && 是过去的日期
            const today = new Date();
            const canRemedy =
              !loading &&
              c.inMonth &&
              isSameMonth(c.date, today) &&
              !c.isToday &&
              !checked &&
              c.date < today;

            const cls = [
              styles.cellBtn,
              !c.inMonth ? styles.outMonth : '',
              c.inMonth && c.isToday ? styles.today : '',
              c.inMonth && c.isToday && !checked ? styles.todayNotChecked : '',
              c.inMonth && c.isToday && checked ? styles.todayChecked : '',
              checked ? styles.checked : '',
              selected ? styles.selected : '',
            ]
              .filter(Boolean)
              .join(' ');

            const label = c.isToday ? '今天' : c.key;

            return (
              <button
                key={i}
                type="button"
                className={cls}
                role="gridcell"
                aria-label={label}
                aria-selected={selected}
                onClick={() => {
                  if (c.isToday && !checked && !loading) {
                    setTodayCheckinOpen(true);
                    return;
                  }
                  onClickDate(c.date, c.key, c.inMonth, checked);
                }}
              >
                {checked && <CheckInSub className={styles.checkMark} />}
                {c.isToday && !checked && <TodaySubIcon className={styles.todaySub} />}
                {canRemedy && <CardReplacement className={styles.remedyMark} />}
                {c.isToday ? (
                  <span className={`${styles.todayLabel} ${styles.dateLabel}`.trim()}>今</span>
                ) : (
                  <span className={styles.dateLabel}>{c.date.getDate()}</span>
                )}
              </button>
            );
          })}
        </div>
      </div>
      <div className={styles.progressContainer}>
        <div className={styles.used}>
          <div>已使用：{countCheckinDays}天</div>
          <button
            type="button"
            className={styles.explanation}
            aria-label="查看活动说明"
            onClick={() => setRuleModalOpen(true)}
          >
            <Explanation />
          </button>
        </div>
        <div className={styles.progressBox}>
          {milestones.map((milestone) => {
            const status = getMilestoneStatus(milestone.days);
            const milestonePosition = Math.min(
              100,
              Math.max(0, (milestone.days / maxDaysInMonth) * 100),
            );

            return (
              <div
                key={milestone.days}
                className={styles.pointWrapper}
                style={{ left: `${milestonePosition}%` }}
              >
                <div className={styles.pointDotCenter}>
                  <Tooltip content={`${formatPoints(milestone.points)}积分`}>
                    <div
                      className={`${styles.pointDot} ${
                        status === 'locked' ? styles.locked : ''
                      } ${status === 'available' ? styles.clickable : ''}`}
                      onClick={() => {
                        if (status === 'available') {
                          onClickClaim(milestone.days, milestone.points);
                        }
                      }}
                    >
                      {status === 'available' && (
                        <AvailableForPickup className={styles.pointIcon} />
                      )}
                      {status === 'claimed' && <Claimed className={styles.pointIcon} />}
                    </div>
                  </Tooltip>
                  <div className={styles.pointLabel}>{milestone.days}天</div>
                </div>
              </div>
            );
          })}
          <div className={styles.progress}>
            <div
              className={styles.progressInner}
              style={{
                width: `${Math.min(100, Math.max(0, (countCheckinDays / maxDaysInMonth) * 100))}%`,
              }}
            ></div>
          </div>
        </div>
      </div>

      <Modal
        open={ruleModalOpen}
        onClose={() => setRuleModalOpen(false)}
        className={styles.ruleModal}
      >
        <div className={styles.ruleBody}>
          <h2 className={styles.ruleTitle}>SenseAudio AI语音输入法打卡送积分活动</h2>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>活动时间</h3>
            <p className={styles.ruleText}>2026年3月1日-4月30日</p>
          </section>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>参与方式</h3>
            <ul className={styles.ruleList}>
              <li className={styles.ruleListItem}>1. 登录SenseAudio客户端。</li>
              <li className={styles.ruleListItem}>2. 唤醒AI语音输入法（在任意应用内即可）。</li>
              <li className={styles.ruleListItem}>
                3. 使用一次输入法（语音识别成功或输出改写内容即可）。
              </li>
            </ul>
            <p className={styles.ruleNote}>注：若出现未识别或识别失败的情况，不计入打卡记录。</p>
          </section>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>每日奖励（自动发放）</h3>
            <ul className={styles.ruleList}>
              <li className={styles.ruleListItem}>只需使用一次，积分即刻入账：</li>
              <li className={styles.ruleListItem}>普通用户：10,000积分/天</li>
              <li className={styles.ruleListItem}>
                付费会员：20,000积分/天（包含：尝鲜版、高级版、专业版用户）
              </li>
            </ul>
          </section>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>月度阶梯赠礼（需手动领取）</h3>
            <ul className={styles.ruleList}>
              <li className={styles.ruleListItem}>
                一个自然月内，累计使用达标，解锁额外惊喜积分：
              </li>
              <li className={styles.ruleListItem}>累计7天：加赠50,000积分</li>
              <li className={styles.ruleListItem}>累计15天：加赠100,000积分</li>
              <li className={styles.ruleListItem}>累计25天：加赠200,000积分</li>
            </ul>
          </section>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>补签规则</h3>
            <ul className={styles.ruleList}>
              <li className={styles.ruleListItem}>
                免费版用户补签：消耗10,000积分/次即可补签，补签后可正常获得当日打卡奖励。
              </li>
              <li className={styles.ruleListItem}>
                付费版用户补签：付费用户每月享有3次免费补签机会。
              </li>
            </ul>
          </section>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>积分使用说明</h3>
            <ul className={styles.ruleList}>
              <li className={styles.ruleListItem}>
                有效期：积分自获取之日起30天内有效，请及时使用。
              </li>
              <li className={styles.ruleListItem}>适用范围：SenseAudio全站产品通用。</li>
            </ul>
          </section>

          <section className={styles.ruleSection}>
            <h3 className={styles.ruleSectionTitle}>温馨提示</h3>
            <ul className={styles.ruleList}>
              <li className={styles.ruleListItem}>请确保在网络环境良好的情况下进行打卡。</li>
              <li className={styles.ruleListItem}>阶梯赠礼需在活动页面手动点击领取，请勿错过。</li>
              <li className={styles.ruleListItem}>本活动最终解释权归SenseAudio语音输入法所有。</li>
            </ul>
          </section>
        </div>
      </Modal>

      <ConfirmDialog
        open={Boolean(remedyTarget)}
        title="确认补签？"
        description={remedyDescription}
        primary
        confirmLoading={remedySubmitting}
        confirmText={remedySubmitting ? '补签中...' : '确认补签'}
        cancelText="取消"
        onCancel={onCancelRemedy}
        onConfirm={() => void onConfirmRemedy()}
      />
      <ConfirmDialog
        open={todayCheckinOpen}
        title="今日签到"
        description={todayCheckinDescription}
        primary
        confirmLoading={todaySubmitting}
        confirmText={todaySubmitting ? '签到中...' : '确认签到'}
        cancelText="取消"
        onCancel={() => {
          if (todaySubmitting) return;
          setTodayCheckinOpen(false);
        }}
        onConfirm={() => void onConfirmTodayCheckin()}
      />
      <ConfirmDialog
        open={Boolean(claimTarget)}
        title="领取累计奖励"
        description={`本月已使用${claimTarget?.days}天，您可以领取${formatPoints(claimTarget?.points ?? 0)}积分，领取后可以再积分详情中查看发放情况。`}
        primary
        confirmLoading={claimSubmitting}
        confirmText={claimSubmitting ? '领取中...' : '确认领取'}
        cancelText="取消"
        onCancel={onCancelClaim}
        onConfirm={() => void onConfirmClaim()}
      />
    </div>
  );
}
