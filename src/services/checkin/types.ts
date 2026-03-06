export type CheckinMonthRequest = {
  /** e.g. 2026 */
  year: number;
  /** 1-12 */
  month: number;
};

export type CheckinRemedyRequest = {
  /** e.g. 2026 */
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
};

export type TodayCheckinRequest = {
  /** e.g. 2026 */
  year: number;
  /** 1-12 */
  month: number;
  /** 1-31 */
  day: number;
};

export type CheckinMonthResponse = {
  /** 已签到日期（当月第几天） */
  is_checkin: number[];
  /** 未签到日期（当月第几天） */
  not_checkin: number[];
  /** 已签到天数 */
  count_checkin_days: number;
  /** 剩余免费补签次数 */
  free_remedy_nums: number;
  /** 已领取的里程碑天数，如 [7, 15, 25] */
  count_checkin_finish_days: number[];
  /** 今天是否已签到 */
  today_checkin?: boolean;
};

export type PostCheckinResponse = {
  /** 本次签到日期，格式：YYYY-MM-DD */
  checked_date: string;
  /** 可选：连续签到天数 */
  streak?: number;
  /** 可选：累计签到天数 */
  total?: number;
};

export type PostCheckinRemedyResponse = {
  /** 补签日期，格式：YYYY-MM-DD */
  checked_date?: string;
  /** 可选：累计签到天数 */
  total?: number;
};

export type CheckinConfigResponse = {
  /** 过期天数 */
  expired: number;
  /** 连续签到15天奖励 */
  fifteen_day: number;
  /** 会员每日签到奖励 */
  member_one_day: number;
  /** 每日签到奖励 */
  on_day: number;
  /** 补签消耗积分 */
  remedy_points: number;
  /** 连续签到7天奖励 */
  seven_day: number;
  /** 连续签到25天奖励 */
  twenty_five_day: number;
};

export type ClaimMilestoneRequest = {
  /** 累计签到天数 */
  count_days: number;
  /** 月份 1-12 */
  month: number;
  /** 年份 */
  year: number;
};

export type ClaimMilestoneResponse = {
  /** 领取的积分数量 */
  points: number;
};
