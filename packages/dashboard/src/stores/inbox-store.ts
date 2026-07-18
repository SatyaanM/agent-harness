import { create } from 'zustand';

export interface InboxItem {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: string;
  content?: string;
}

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

const BASE_URL = 'http://localhost:3001';

export const useInboxStore = create<InboxState>((set) => ({
  items: [],
  currentItem: null,
  isLoading: false,
  error: null,
  fetchItems: async () => {
    set({ isLoading: true, error: null });
    try {
      const res = await fetch(`${BASE_URL}/api/inbox`);
      if (!res.ok) throw new Error(`Failed to fetch inbox items (${res.status})`);
      const items: InboxItem[] = await res.json();
      set({ items, isLoading: false });
    } catch (err) {
      set({ isLoading: false, error: err instanceof Error ? err.message : 'Failed to load inbox' });
    }
  },
  setCurrentItem: (item) => set({ currentItem: item }),
  clearCurrentItem: () => set({ currentItem: null }),
  clearError: () => set({ error: null }),
}));
