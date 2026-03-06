import { create } from 'zustand';

type CheckinState = {
  todayCheckin: boolean;
  calendarRefreshVersion: number;
};

type CheckinActions = {
  setTodayCheckin: (todayCheckin: boolean) => void;
  requestCalendarRefresh: () => void;
};

export const useCheckinStore = create<CheckinState & CheckinActions>((set) => ({
  todayCheckin: false,
  calendarRefreshVersion: 0,
  setTodayCheckin: (todayCheckin: boolean) => set({ todayCheckin }),
  requestCalendarRefresh: () =>
    set((state) => ({ calendarRefreshVersion: state.calendarRefreshVersion + 1 })),
}));
