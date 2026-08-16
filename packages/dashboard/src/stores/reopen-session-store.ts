import { create } from "zustand";

interface ReopenSessionState {
  open: boolean;
  setOpen: (open: boolean) => void;
}

export const useReopenSessionStore = create<ReopenSessionState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
}));
