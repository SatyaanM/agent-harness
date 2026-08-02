import { create } from 'zustand';

export type WorkerStatus = 'running' | 'done' | 'error';

export interface WorkerEntry {
  id: string;
  name: string;
  taskId: string;
  task: string;
  status: WorkerStatus;
}

interface RosterState {
  bySession: Record<string, WorkerEntry[]>;
  addWorker: (sessionId: string, entry: WorkerEntry) => void;
  setWorkerStatus: (sessionId: string, taskId: string, status: WorkerStatus) => void;
  clear: (sessionId: string) => void;
}

export const useRosterStore = create<RosterState>((set) => ({
  bySession: {},
  addWorker: (sessionId, entry) =>
    set((state) => {
      const list = state.bySession[sessionId] ?? [];
      if (list.some((w) => w.id === entry.id)) return state;
      return {
        bySession: {
          ...state.bySession,
          [sessionId]: [...list, entry],
        },
      };
    }),
  setWorkerStatus: (sessionId, taskId, status) =>
    set((state) => ({
      bySession: {
        ...state.bySession,
        [sessionId]: (state.bySession[sessionId] ?? []).map((w) =>
          w.taskId === taskId ? { ...w, status } : w
        ),
      },
    })),
  clear: (sessionId) =>
    set((state) => {
      const next = { ...state.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));
