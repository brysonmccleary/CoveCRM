import { create } from "zustand";

interface CallStore {
  activeLeads: any[];
  currentIndex: number;
  setLeads: (leads: any[]) => void;
  nextLead: () => void;
}

export const useCallStore = create<CallStore>((set) => ({
  activeLeads: [],
  currentIndex: 0,
  setLeads: (leads) => set({ activeLeads: leads, currentIndex: 0 }),
  nextLead: () =>
    set((state) => ({
      currentIndex: state.currentIndex + 1 < state.activeLeads.length
        ? state.currentIndex + 1
        : state.currentIndex,
    })),
}));

