import { create } from "zustand";
import { fetchInboxItems, type InboxItem } from "@/lib/api";

export type { InboxItem } from "@/lib/api";

interface InboxState {
  items: InboxItem[];
  currentItem: InboxItem | null;
  isLoading: boolean;
  error: string | null;
  fetchItems: () => Promise<void>;
  setCurrentItem: (item: InboxItem) => void;
  clearCurrentItem: () => void;
  clearError: () => void;
}

export const useInboxStore = create<InboxState>((set) => ({
  items: [],
  currentItem: null,
  isLoading: false,
  error: null,
  fetchItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const items = await fetchInboxItems();
      set({ items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : "Failed to load inbox" });
    }
  },
  setCurrentItem: (item) => set({ currentItem: item }),
  clearCurrentItem: () => set({ currentItem: null }),
  clearError: () => set({ error: null }),
}));
