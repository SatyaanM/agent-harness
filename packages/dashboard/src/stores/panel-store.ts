import { create } from 'zustand';

interface PanelStore {
  collapsed: boolean;
  expanded: boolean;
  toggleCollapsed: () => void;
  toggleExpanded: () => void;
}

export const usePanelStore = create<PanelStore>((set) => ({
  collapsed: false,
  expanded: true,

  toggleCollapsed: () =>
    set((state) => ({ collapsed: !state.collapsed, expanded: state.collapsed })),

  toggleExpanded: () =>
    set((state) => ({ expanded: !state.expanded, collapsed: state.expanded })),
}));
