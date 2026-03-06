import type {
  MeetingRecordsRequest,
  MeetingRecordsResponse,
  RenameMeetingRequest,
  MeetingDetailResponse,
  MeetingSummary,
} from './types';
import { get, put, del, post } from '../request';
import type { ResponseType } from '../request';

/**
 * 获取会议记录列表
 */
export const getMeetingRecords = (
  params: MeetingRecordsRequest,
): Promise<ResponseType<MeetingRecordsResponse>> => {
  return get('/api/sensetype/meeting/records', { ...params });
};

/**
 * 重命名会议记录
 */
export const renameMeeting = (params: RenameMeetingRequest): Promise<ResponseType<void>> => {
  const { id, title } = params;
  return put(`/api/sensetype/meeting/records/${id}/title`, { title });
};
/**
 * 获取会议记录详情
 */
export const getMeetingDetail = (id: string): Promise<ResponseType<MeetingDetailResponse>> => {
  return get(`/api/sensetype/meeting/records/${id}`);
};

/**
 * 删除会议记录
 */
export const deleteMeeting = (id: string): Promise<ResponseType<void>> => {
  return del(`/api/sensetype/meeting/records/${id}`);
};

/**
 * 批量删除会议记录
 */
export const batchDeleteMeetings = (ids: string[]): Promise<ResponseType<void>> => {
  return post('/api/sensetype/meeting/records/batch/delete', { ids });
};

//更新会议总结
export const updateMeetingSummary = (id: string, summary: MeetingSummary): Promise<ResponseType<void>> => {
  return put(`/api/sensetype/meeting/records/${id}/summary`, { summary });
};
