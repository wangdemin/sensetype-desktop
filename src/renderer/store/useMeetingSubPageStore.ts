import { create } from 'zustand';

export type MeetingSubPage = 'list' | 'detail' | 'recording';

type MeetingState = {
  subPage: MeetingSubPage;
  isRecordingActive: boolean;
  requestStopConfirm: (() => void) | null;
};

type MeetingActions = {
  setSubPage: (subPage: MeetingSubPage) => void;
  setRecordingGuard: (payload: {
    isRecordingActive: boolean;
    requestStopConfirm: (() => void) | null;
  }) => void;
  clearRecordingGuard: () => void;
};

export const useMeetingStore = create<MeetingState & MeetingActions>((set) => ({
  subPage: 'list',
  isRecordingActive: false,
  requestStopConfirm: null,

  setSubPage: (subPage) => set({ subPage }),
  setRecordingGuard: ({ isRecordingActive, requestStopConfirm }) =>
    set({
      isRecordingActive: !!isRecordingActive,
      requestStopConfirm: requestStopConfirm ?? null,
    }),
  clearRecordingGuard: () =>
    set({
      isRecordingActive: false,
      requestStopConfirm: null,
    }),
}));
