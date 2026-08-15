import { create } from "zustand";

export const MAX_TOOL_ACTIVITY_PER_SESSION = 200;

export interface ToolActivity {
  id: string;
  agentName: string;
  toolName: string;
  type: "called" | "completed";
  args?: unknown;
  result?: string;
  timestamp: number;
}

interface RuntimeStore {
  activity: Record<string, ToolActivity[]>;
  running: Record<string, boolean>;
  record: (sessionId: string, activity: ToolActivity) => void;
  setRunning: (sessionId: string, running: boolean) => void;
  clear: (sessionId: string) => void;
}

export const useRuntimeStore = create<RuntimeStore>((set) => ({
  activity: {},
  running: {},
  record: (sessionId, activity) =>
    set((state) => ({
      activity: {
        ...state.activity,
        [sessionId]: [...(state.activity[sessionId] ?? []), activity].slice(
          -MAX_TOOL_ACTIVITY_PER_SESSION,
        ),
      },
    })),
  setRunning: (sessionId, running) =>
    set((state) => ({
      running: { ...state.running, [sessionId]: running },
    })),
  clear: (sessionId) =>
    set((state) => {
      const next = { ...state.activity };
      const nextRunning = { ...state.running };
      delete next[sessionId];
      delete nextRunning[sessionId];
      return { activity: next, running: nextRunning };
    }),
}));
