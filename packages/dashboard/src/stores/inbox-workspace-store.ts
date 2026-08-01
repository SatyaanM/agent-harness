import { create } from 'zustand';

interface InboxWorkspaceState {
  selectedPath: string | null;
  setSelectedPath: (path: string | null) => void;
}

export const useInboxWorkspaceStore = create<InboxWorkspaceState>((set) => ({
  selectedPath: null,
  setSelectedPath: (path) => set({ selectedPath: path }),
}));
