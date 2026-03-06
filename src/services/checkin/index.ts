import { get, post } from '../request';
import type { ResponseType } from '../request';
import type {
  CheckinMonthRequest,
  CheckinMonthResponse,
  CheckinRemedyRequest,
  TodayCheckinRequest,
  PostCheckinRemedyResponse,
  PostCheckinResponse,
  CheckinConfigResponse,
  ClaimMilestoneRequest,
  ClaimMilestoneResponse,
} from './types';

/**
 * 签到接口（后端未定：当前为“契约占位”）。
 *
 * 后端落地时：只需要把 URL 与字段映射对齐即可；UI/Hook 不用动。
 */

// 获取某月签到记录
export const getCheckinMonth = (
  params: CheckinMonthRequest,
): Promise<ResponseType<CheckinMonthResponse>> => {
  return get('/api/sensetype/checkin/records', params as unknown as Record<string, unknown>);
};

// 今日签到
export const postCheckin = (): Promise<ResponseType<PostCheckinResponse>> => {
  // TODO(backend): 确认真实路径，例如：/api/sensetype/checkin
  return post('/api/sensetype/checkin');
};

// 今日手动签到
export const postTodayCheckin = (
  params: TodayCheckinRequest,
): Promise<ResponseType<PostCheckinResponse>> => {
  return post('/api/sensetype/checkin/today', params);
};

// 补签
export const postCheckinRemedy = (
  params: CheckinRemedyRequest,
): Promise<ResponseType<PostCheckinRemedyResponse>> => {
  return post('/api/sensetype/checkin/remedy', params);
};

// 获取签到配置
export const getCheckinConfig = (): Promise<ResponseType<CheckinConfigResponse>> => {
  return get('/api/sensetype/checkin/config');
};

// 领取里程碑奖励
export const postClaimMilestone = (
  params: ClaimMilestoneRequest,
): Promise<ResponseType<ClaimMilestoneResponse>> => {
  return post('/api/sensetype/checkin/countReward', params);
};
