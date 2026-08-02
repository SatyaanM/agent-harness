import { create } from 'zustand';

export interface ToolActivity {
  id: string;
  agentName: string;
  toolName: string;
  type: 'called' | 'completed';
  args?: unknown;
  result?: string;
  timestamp: number;
}

interface RuntimeStore {
  activity: Record<string, ToolActivity[]>;
  record: (sessionId: string, activity: ToolActivity) => void;
  clear: (sessionId: string) => void;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  activity: {},
  record: (sessionId, activity) =>
    set((state) => ({
      activity: {
        ...state.activity,
        [sessionId]: [...(state.activity[sessionId] ?? []), activity],
      },
    })),
  clear: (sessionId) =>
    set((state) => {
      const next = { ...state.activity };
      delete next[sessionId];
      return { activity: next };
    }),
}));
