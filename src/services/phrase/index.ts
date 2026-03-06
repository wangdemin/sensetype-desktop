import { del, get, post, put } from '../request';
import type { SensetypeKeywordsReq } from './types';

// 获取短语列表
export const getKeywordsListApi = (params: SensetypeKeywordsReq): Promise<any> => {
  return get('/api/sensetype/keywords', { ...params });
};

// 创建短语
export const addKeywordsApi = (data: { keyword: string; content: string }): Promise<any> => {
  return post('/api/sensetype/keyword', data);
};

// 更新短语
export const updateKeywordsApi = (
  id: string,
  data: { keyword: string; content: string },
): Promise<any> => {
  return put(`/api/sensetype/keyword/${id}`, data);
};

// 删除短语
export const deleteKeywordsApi = (id: string): Promise<any> => {
  return del(`/api/sensetype/keyword/${id}`);
};
