import { create } from 'zustand';

interface SidebarState {
  collapsed: boolean;
  init: () => void;
  toggle: () => void;
}

export const useSidebarStore = create<SidebarState>((set, get) => ({
  collapsed: false,
  init: () => {
    if (typeof window === 'undefined') return;
    let collapsed = false;
    try {
      collapsed = localStorage.getItem('sidebar-collapsed') === '1';
    } catch {}
    set({ collapsed });
  },
  toggle: () => {
    const next = !get().collapsed;
    set({ collapsed: next });
    try {
      localStorage.setItem('sidebar-collapsed', next ? '1' : '0');
    } catch {}
  },
}));
