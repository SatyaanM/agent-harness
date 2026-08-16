"use client";

import { createLogger, describeError } from "@agent-harness/core/contracts";
import { useCallback, useEffect, useRef } from "react";
import {
  fetchOpenSessions,
  fetchSession,
  type OpenSessionsState,
  updateOpenSessions,
} from "@/lib/api";
import {
  AgentLifecycleEventSchema,
  connectSocket,
  SessionUpdatedEventSchema,
  ToolEventSchema,
  validatedEventHandler,
  WorkerCompletedEventSchema,
  WorkerSpawnedEventSchema,
} from "@/lib/ws";
import { useRosterStore } from "@/stores/agent-roster-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSessionStore } from "@/stores/session-store";

const logger = createLogger("dashboard.runtime-sync");

export function resolveRestoredOpenState(
  open: OpenSessionsState,
  restored: Array<{ sessionId: string }>,
): OpenSessionsState {
  const openSessionIds = restored.map((session) => session.sessionId);
  const restoredIds = new Set(openSessionIds);
  const activeSessionId =
    open.activeSessionId !== null && restoredIds.has(open.activeSessionId)
      ? open.activeSessionId
      : (openSessionIds[0] ?? null);
  return { activeSessionId, openSessionIds };
}

export default function RuntimeSync() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const hydrated = useRef(false);

  const hydrateOpenSessions = useCallback(async (signal?: { cancelled: boolean }) => {
    try {
      const open = await fetchOpenSessions();
      const restored = (
        await Promise.all(open.openSessionIds.map((id) => fetchSession(id).catch(() => null)))
      ).filter((s): s is NonNullable<typeof s> => s !== null);
      if (signal?.cancelled) return;

      useSessionStore.getState().hydrate(restored);
      const repaired = resolveRestoredOpenState(open, restored);
      useSessionStore.getState().setActiveSession(repaired.activeSessionId);
      if (
        repaired.activeSessionId !== open.activeSessionId ||
        repaired.openSessionIds.length !== open.openSessionIds.length
      ) {
        await updateOpenSessions(repaired);
      }
      hydrated.current = true;
    } catch (err) {
      logger.error("hydration failed", { ...describeError(err) });
    }
  }, []);

  // Boot hydration: restore the recorded open set as tabs, history only
  // (ADR §12.3 — no runtime loads, no token spend).
  useEffect(() => {
    const signal = { cancelled: false };
    void hydrateOpenSessions(signal);
    return () => {
      signal.cancelled = true;
    };
  }, [hydrateOpenSessions]);

  // Registry sync: the dashboard is the single writer of the open set (ADR §12.1).
  useEffect(() => {
    if (!hydrated.current) {
      if (sessions.length > 0 || activeSessionId !== null) {
        hydrated.current = true;
      } else {
        return;
      }
    }
    updateOpenSessions({
      activeSessionId,
      openSessionIds: sessions.map((s) => s.sessionId),
    }).catch((err) => logger.error("registry sync failed", { ...describeError(err) }));
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const socket = connectSocket();

    const onConnect = async () => {
      if (!hydrated.current) {
        await hydrateOpenSessions();
        return;
      }
      const currentSessions = useSessionStore.getState().sessions;
      await Promise.all(
        currentSessions.map(async (s) => {
          const latest = await fetchSession(s.sessionId).catch(() => null);
          if (latest) {
            useSessionStore.getState().syncFromServer(latest);
          }
        }),
      );
    };

    const onSessionUpdated = validatedEventHandler(
      SessionUpdatedEventSchema,
      "session:updated event",
      (data) => useSessionStore.getState().syncFromServer(data),
    );

    const onTool = validatedEventHandler(ToolEventSchema, "agent:tool event", (data) => {
      useRuntimeStore.getState().record(data.sessionId, {
        id: `${data.agentName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentName: data.agentName,
        toolName: data.tool.toolName,
        type: data.tool.type,
        args: data.tool.args,
        result: data.tool.result,
        timestamp: Date.now(),
      });
    });

    const onAgentStarted = validatedEventHandler(
      AgentLifecycleEventSchema,
      "agent:started event",
      (data) => useRuntimeStore.getState().setRunning(data.sessionId, true),
    );
    const onAgentDone = validatedEventHandler(
      AgentLifecycleEventSchema,
      "agent completion event",
      (data) => useRuntimeStore.getState().setRunning(data.sessionId, false),
    );

    const onWorkerSpawned = validatedEventHandler(
      WorkerSpawnedEventSchema,
      "worker:spawned event",
      (data) => {
        useRosterStore.getState().addWorker(data.sessionId, {
          id: data.workerSessionId,
          name: `worker-${data.taskId.slice(0, 6)}`,
          taskId: data.taskId,
          task: data.task,
          status: "running",
        });
      },
    );

    const onWorkerCompleted = validatedEventHandler(
      WorkerCompletedEventSchema,
      "worker:completed event",
      (data) => useRosterStore.getState().setWorkerStatus(data.sessionId, data.taskId, data.status),
    );

    socket.on("connect", onConnect);
    socket.on("session:updated", onSessionUpdated);
    socket.on("agent:tool", onTool);
    socket.on("agent:started", onAgentStarted);
    socket.on("agent:completed", onAgentDone);
    socket.on("agent:error", onAgentDone);
    socket.on("worker:spawned", onWorkerSpawned);
    socket.on("worker:completed", onWorkerCompleted);

    return () => {
      socket.off("connect", onConnect);
      socket.off("session:updated", onSessionUpdated);
      socket.off("agent:tool", onTool);
      socket.off("agent:started", onAgentStarted);
      socket.off("agent:completed", onAgentDone);
      socket.off("agent:error", onAgentDone);
      socket.off("worker:spawned", onWorkerSpawned);
      socket.off("worker:completed", onWorkerCompleted);
    };
  }, [hydrateOpenSessions]);

  return null;
}
