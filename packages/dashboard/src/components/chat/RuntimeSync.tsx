"use client";

import { useEffect, useRef } from "react";
import { fetchOpenSessions, fetchSession, updateOpenSessions } from "@/lib/api";
import { connectSocket } from "@/lib/ws";
import { useRosterStore } from "@/stores/agent-roster-store";
import { useRuntimeStore } from "@/stores/runtime-store";
import { useSessionStore } from "@/stores/session-store";

interface ToolEventPayload {
  sessionId: string;
  agentName: string;
  tool: { type: "called" | "completed"; toolName: string; args?: unknown; result?: string };
}

interface SessionUpdatedPayload {
  sessionId: string;
  agentName?: string;
  title?: string;
  createdAt?: string;
  messages: Array<{
    role: "system" | "user" | "assistant" | "tool";
    content: string;
    reasoning?: string;
    toolCalls?: Array<{ toolCallId: string; toolName: string; args: Record<string, unknown> }>;
    toolCallId?: string;
    createdAt?: string;
    meta?: unknown;
  }>;
}

interface WorkerSpawnedPayload {
  sessionId: string;
  taskId: string;
  workerSessionId: string;
  task: string;
}

interface WorkerCompletedPayload {
  sessionId: string;
  taskId: string;
  agentName: string;
  status: "done" | "error" | "cancelled";
  summary: string;
}

export default function RuntimeSync() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const hydrated = useRef(false);

  // Boot hydration: restore the recorded open set as tabs, history only
  // (ADR §12.3 — no runtime loads, no token spend).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const open = await fetchOpenSessions();
        const restored = (
          await Promise.all(open.openSessionIds.map((id) => fetchSession(id).catch(() => null)))
        ).filter((s): s is NonNullable<typeof s> => s !== null);
        if (cancelled) return;

        useSessionStore.getState().hydrate(restored);
        const openIds = new Set(open.openSessionIds);
        const validActive = open.activeSessionId !== null && openIds.has(open.activeSessionId);
        const active = validActive ? open.activeSessionId : (restored[0]?.sessionId ?? null);
        if (active) useSessionStore.getState().setActiveSession(active);
      } catch (err) {
        console.error("[RuntimeSync] hydration failed:", err);
      } finally {
        hydrated.current = true;
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Registry sync: the dashboard is the single writer of the open set (ADR §12.1).
  useEffect(() => {
    if (!hydrated.current) return;
    updateOpenSessions({
      activeSessionId,
      openSessionIds: sessions.map((s) => s.sessionId),
    }).catch((err) => console.error("[RuntimeSync] registry sync failed:", err));
  }, [sessions, activeSessionId]);

  useEffect(() => {
    const socket = connectSocket();

    const onSessionUpdated = (data: SessionUpdatedPayload) => {
      useSessionStore.getState().syncFromServer(data);
    };

    const onTool = (data: ToolEventPayload) => {
      if (!data.tool) return;
      useRuntimeStore.getState().record(data.sessionId, {
        id: `${data.agentName}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        agentName: data.agentName,
        toolName: data.tool.toolName,
        type: data.tool.type,
        args: data.tool.args,
        result: data.tool.result,
        timestamp: Date.now(),
      });
    };

    const onAgentStarted = (data: { sessionId: string }) => {
      useRuntimeStore.getState().setRunning(data.sessionId, true);
    };
    const onAgentDone = (data: { sessionId: string }) => {
      useRuntimeStore.getState().setRunning(data.sessionId, false);
    };

    const onWorkerSpawned = (data: WorkerSpawnedPayload) => {
      useRosterStore.getState().addWorker(data.sessionId, {
        id: data.workerSessionId,
        name: `worker-${data.taskId.slice(0, 6)}`,
        taskId: data.taskId,
        task: data.task,
        status: "running",
      });
    };

    const onWorkerCompleted = (data: WorkerCompletedPayload) => {
      useRosterStore.getState().setWorkerStatus(data.sessionId, data.taskId, data.status);
    };

    socket.on("session:updated", onSessionUpdated);
    socket.on("agent:tool", onTool);
    socket.on("agent:started", onAgentStarted);
    socket.on("agent:completed", onAgentDone);
    socket.on("agent:error", onAgentDone);
    socket.on("worker:spawned", onWorkerSpawned);
    socket.on("worker:completed", onWorkerCompleted);

    return () => {
      socket.off("session:updated", onSessionUpdated);
      socket.off("agent:tool", onTool);
      socket.off("agent:started", onAgentStarted);
      socket.off("agent:completed", onAgentDone);
      socket.off("agent:error", onAgentDone);
      socket.off("worker:spawned", onWorkerSpawned);
      socket.off("worker:completed", onWorkerCompleted);
    };
  }, []);

  return null;
}
