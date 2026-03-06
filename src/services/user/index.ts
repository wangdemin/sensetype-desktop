import { get, post } from '../request';
import type { ResponseType } from '../request';
import type {
  LoginParams,
  LoginResult,
  SendSmsParams,
  UserInfo,
  SmsCodeResult,
  PointRecordsRequest,
  PointRecordsResponse,
  PointsResponse,
  LatestVersionRequest,
  LatestVersionResponse,
  CurrentCycleResponse,
  InviteFriendsResponse,
} from './types';

// 登录
export const login = (params: LoginParams): Promise<ResponseType<LoginResult>> => {
  return post('/v1/auth/login', params);
};

// 获取网页端 token（用于打开浏览器页面时免登录）
export const acquireToken = (params: {
  platform: string;
  product: string;
}): Promise<
  ResponseType<{
    token?: string;
  }>
> => {
  return post('/api/user/acquire_token', params);
};

// 获取用户信息
export const getUser = (): Promise<ResponseType<UserInfo>> => {
  return get('/api/user/self');
};

// 发送短信验证码
export const sendSmsCode = (params: SendSmsParams): Promise<ResponseType<SmsCodeResult>> => {
  return post('/api/user/sms/send', params);
};

// 获取积分使用明细
export const pointRecordsApi = (
  params: PointRecordsRequest,
): Promise<ResponseType<PointRecordsResponse>> => {
  return get('/api/user/point-records', params);
};

// 获取积分信息
export const pointsApi = (): Promise<ResponseType<PointsResponse>> => {
  return get('/api/user/points');
};

// 获取最新版本信息
export const latestVersionApi = (
  params: LatestVersionRequest,
): Promise<ResponseType<LatestVersionResponse>> => {
  return get('/api/sensetype/latest', params as unknown as Record<string, unknown>);
};

// 登出
export const logoutApi = (): Promise<ResponseType<void>> => {
  return get('/v1/auth/logout');
};

// 获取当前套餐周期
export const currentCycleApi = (): Promise<ResponseType<CurrentCycleResponse>> => {
  return get('/api/user/subscription/current_cycle');
};
// 获取邀请码
export const inviteFriendsApi = (): Promise<ResponseType<InviteFriendsResponse>> => {
  return get('/api/user/invitation/code');
};
