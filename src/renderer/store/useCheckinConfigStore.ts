import { create } from 'zustand';
import { getCheckinConfig } from '@/services/checkin';
import type { CheckinConfigResponse } from '@/services/checkin/types';

type CheckinConfigState = {
  config: CheckinConfigResponse | null;
  loading: boolean;
};

type CheckinConfigActions = {
  fetchConfig: () => Promise<void>;
  getRemedyPoints: () => number;
  getMemberRemedyPoints: () => number;
};

/**
 * 签到配置全局状态管理
 * - 存储签到相关的配置数据（积分消耗、奖励等）
 * - 在切换到 home 页面时自动刷新
 */
export const useCheckinConfigStore = create<CheckinConfigState & CheckinConfigActions>(
  (set, get) => ({
    config: null,
    loading: false,

    fetchConfig: async () => {
      set({ loading: true });
      try {
        const resp = await getCheckinConfig();
        if (resp.success) {
          console.log('获取签到配置成功:', resp.data);
          set({ config: resp.data, loading: false });
        } else {
          set({ loading: false });
        }
      } catch (error) {
        console.error('获取签到配置失败:', error);
        set({ loading: false });
      }
    },

    getRemedyPoints: () => {
      return get().config?.remedy_points ?? 0;
    },

    getMemberRemedyPoints: () => {
      return get().config?.member_one_day ?? 0;
    },
  }),
);
