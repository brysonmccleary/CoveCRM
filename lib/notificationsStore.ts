// /lib/notificationsStore.ts
import { create } from "zustand";

type State = {
  unreadByLead: Record<string, number>;
  inc: (leadId: string) => void;
  clear: (leadId: string) => void;
  reset: () => void;
};

export const useNotifStore = create<State>((set) => ({
  unreadByLead: {},
  inc: (leadId) =>
    set((s) => ({
      unreadByLead: {
        ...s.unreadByLead,
        [leadId]: (s.unreadByLead[leadId] || 0) + 1,
      },
    })),
  clear: (leadId) =>
    set((s) => {
      const copy = { ...s.unreadByLead };
      delete copy[leadId];
      return { unreadByLead: copy };
    }),
  reset: () => set({ unreadByLead: {} }),
}));
