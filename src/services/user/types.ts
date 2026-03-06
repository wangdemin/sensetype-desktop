export interface LoginParams {
  invitation_code?: string;
  phone: string;
  verify_code: string;
}

export interface LoginResult {
  token: string;
  user: UserInfo;
  userStatus: number;
}

export interface CertInfo {
  personal_cert_verified: boolean;
  enterprise_cert_verified: boolean;
}

export interface UserInfo {
  id: string;
  username: string;
  avatar: string;
  phone: string;
  email: string;
  role: number;
  status: number;
  points: number;
  last_login: number;
  cert_info: CertInfo;
  created_at: number;
  [key: string]: any;
}

export interface SendSmsParams {
  phone: string;
}

export interface SmsCodeResult {
  new_user: boolean;
}

// 积分记录相关类型
export interface PointRecordsRequest {
  /**
   * 结束时间(时间戳 秒)
   */
  end_time?: number;
  /**
   * 页码
   */
  page: number;
  /**
   * 关联记录类型
   */
  reference_type?: string;
  /**
   * 每页数量
   */
  size: number;
  /**
   * 开始时间(时间戳 秒)
   */
  start_time?: number;
  /**
   * 交易类型 income:增加 expense:消耗
   */
  transaction_type?: string;
  [property: string]: any;
}

export interface PointRecordsResponse {
  list: PointRecordsItem[];
  total: number;
}

export interface PointRecordsItem {
  id: string;
  user_id: string;
  transaction_type: string;
  amount: number;
  balance_before: number;
  balance_after: number;
  reason: string;
  reference_id: string;
  reference_type: string;
  source: string;
  created_at: number;
}

export interface PointsResponse {
  details: PointDetailItem[];
  total_points: number;
}

export interface PointDetailItem {
  name: string;
  points: number;
}

export interface LatestVersionRequest {
  only_ver: boolean;
}

export interface LatestVersionResponse {
  version: string;
  change_log: string;
}

export interface CurrentCycleResponse {
  id: string;
  plan_id: string;
  plan_name: string;
  plan_level: number;
  plan_points: number;
  plan_point_remains: number;
  plan_points_reset_at: number;
  active_at: number;
  expire_at: number;
}

export interface InviteFriendsResponse {
  code: string;
  count: number;
  points: number;
}
