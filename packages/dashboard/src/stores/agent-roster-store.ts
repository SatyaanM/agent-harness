import {
  MAX_WORKERS_PER_SESSION as WORKER_ROSTER_CAPACITY,
  type WorkerStatus,
  type WorkerSummary,
} from "@agent-harness/core/contracts";
import { create } from "zustand";

export { MAX_WORKERS_PER_SESSION } from "@agent-harness/core/contracts";

export interface WorkerEntry {
  id: string; // workerSessionId
  name: string; // agentName
  taskId: string;
  task: string; // description
  status: WorkerStatus;
  createdAt?: string;
  updatedAt?: string;
  localSequence?: number;
}

interface RosterState {
  bySession: Record<string, WorkerEntry[]>;
  addWorker: (sessionId: string, entry: WorkerEntry) => void;
  setWorkerStatus: (sessionId: string, taskId: string, status: WorkerStatus) => void;
  beginHydration: (sessionId: string) => number;
  cancelHydration: (sessionId: string) => void;
  hydrate: (sessionId: string, workers: WorkerSummary[], requestSequence: number) => void;
  clear: (sessionId: string) => void;
}

let rosterSequence = 0;
const latestHydrationSequence = new Map<string, number>();

function nextRosterSequence(): number {
  rosterSequence += 1;
  return rosterSequence;
}

export const useRosterStore = create<RosterState>((set) => ({
  bySession: {},
  addWorker: (sessionId, entry) =>
    set((state) => {
      const list = state.bySession[sessionId] ?? [];
      if (list.some((w) => w.id === entry.id)) return state;
      const now = new Date().toISOString();
      return {
        bySession: {
          ...state.bySession,
          [sessionId]: [
            ...list,
            {
              ...entry,
              createdAt: entry.createdAt ?? now,
              updatedAt: entry.updatedAt ?? now,
              localSequence: nextRosterSequence(),
            },
          ].slice(-WORKER_ROSTER_CAPACITY),
        },
      };
    }),
  setWorkerStatus: (sessionId, taskId, status) =>
    set((state) => {
      const list = state.bySession[sessionId] ?? [];
      const updatedAt = new Date().toISOString();
      const localSequence = nextRosterSequence();
      const found = list.some((worker) => worker.taskId === taskId);
      const updated = found
        ? list.map((worker) =>
            worker.taskId === taskId ? { ...worker, status, updatedAt, localSequence } : worker,
          )
        : [
            ...list,
            {
              id: `pending-${taskId}`,
              name: `worker-${taskId.slice(0, 6)}`,
              taskId,
              task: "",
              status,
              createdAt: updatedAt,
              updatedAt,
              localSequence,
            },
          ];

      return {
        bySession: {
          ...state.bySession,
          [sessionId]: updated.slice(-WORKER_ROSTER_CAPACITY),
        },
      };
    }),
  beginHydration: (sessionId) => {
    const sequence = nextRosterSequence();
    latestHydrationSequence.set(sessionId, sequence);
    return sequence;
  },
  cancelHydration: (sessionId) => {
    latestHydrationSequence.delete(sessionId);
  },
  hydrate: (sessionId, workers, requestSequence) =>
    set((state) => {
      if (latestHydrationSequence.get(sessionId) !== requestSequence) return state;
      const list = state.bySession[sessionId] ?? [];
      const merged = new Map<string, WorkerEntry>();

      // The REST response is authoritative for state that existed when the
      // request began. Preserve only socket events that arrived afterwards.
      for (const existing of list) {
        if ((existing.localSequence ?? 0) > requestSequence) {
          merged.set(existing.taskId, existing);
        }
      }

      for (const w of workers) {
        const existing = list.find((entry) => entry.taskId === w.taskId);
        if ((existing?.localSequence ?? 0) <= requestSequence) {
          merged.set(w.taskId, {
            id: w.workerSessionId ?? `pending-${w.taskId}`,
            name: w.agentName,
            taskId: w.taskId,
            task: w.description,
            status: w.status,
            createdAt: w.createdAt,
            updatedAt: w.updatedAt,
            localSequence: requestSequence,
          });
        } else if (existing) {
          merged.set(w.taskId, {
            id: w.workerSessionId ?? existing.id,
            name: w.agentName,
            taskId: w.taskId,
            task: w.description,
            status: existing.status,
            createdAt: w.createdAt,
            updatedAt: existing.updatedAt ?? w.updatedAt,
            localSequence: existing.localSequence,
          });
        }
      }

      const sorted = Array.from(merged.values())
        .sort((a, b) => {
          const aIsPostRequest = (a.localSequence ?? 0) > requestSequence ? 1 : 0;
          const bIsPostRequest = (b.localSequence ?? 0) > requestSequence ? 1 : 0;
          if (aIsPostRequest !== bIsPostRequest) return aIsPostRequest - bIsPostRequest;
          const aTime = a.createdAt ? new Date(a.createdAt).getTime() : 0;
          const bTime = b.createdAt ? new Date(b.createdAt).getTime() : 0;
          return aTime - bTime;
        })
        .slice(-WORKER_ROSTER_CAPACITY);

      return {
        bySession: {
          ...state.bySession,
          [sessionId]: sorted,
        },
      };
    }),
  clear: (sessionId) =>
    set((state) => {
      const next = { ...state.bySession };
      delete next[sessionId];
      return { bySession: next };
    }),
}));
