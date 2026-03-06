import { del, get, post, put } from '../request';
import type { SensetypeHotwordsReq } from './types';

// 获取热词列表
export const getHotwordsListApi = (params: SensetypeHotwordsReq): Promise<any> => {
  return get('/api/sensetype/hotwords', { ...params });
};

// 创建热词
export const addHotwordApi = (data: { word: string }): Promise<any> => {
  return post('/api/sensetype/hotword', data);
};

// 更新热词
export const updateHotwordApi = (id: string, data: { word: string }): Promise<any> => {
  return put(`/api/sensetype/hotword/${id}`, data);
};

// 删除热词
export const deleteHotwordApi = (id: string): Promise<any> => {
  return del(`/api/sensetype/hotword/${id}`);
};
