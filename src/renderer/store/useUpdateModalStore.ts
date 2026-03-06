import { create } from 'zustand';

type UpdateModalState = {
  updateAvailableModalOpen: boolean;
  latestVersion: string;
};

type UpdateModalActions = {
  openUpdateAvailableModal: (version?: string) => void;
  closeUpdateAvailableModal: () => void;
  setLatestVersion: (version: string) => void;
};

export const useUpdateModalStore = create<UpdateModalState & UpdateModalActions>((set) => ({
  updateAvailableModalOpen: false,
  latestVersion: '',

  openUpdateAvailableModal: (version) =>
    set((prev) => ({
      updateAvailableModalOpen: true,
      latestVersion: typeof version === 'string' ? version : prev.latestVersion,
    })),

  closeUpdateAvailableModal: () => set({ updateAvailableModalOpen: false }),

  setLatestVersion: (version) => set({ latestVersion: String(version ?? '') }),
}));

// 便于任意模块“全局调用”的方法（不依赖 React hooks）
export function openUpdateAvailableModal(version?: string) {
  useUpdateModalStore.getState().openUpdateAvailableModal(version);
}

export function closeUpdateAvailableModal() {
  useUpdateModalStore.getState().closeUpdateAvailableModal();
}
