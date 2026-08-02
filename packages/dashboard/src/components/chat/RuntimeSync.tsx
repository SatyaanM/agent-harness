'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useRuntimeStore } from '@/stores/runtime-store';
import { useRosterStore } from '@/stores/agent-roster-store';
import { connectSocket } from '@/lib/ws';

interface ToolEventPayload {
  sessionId: string;
  agentName: string;
  tool: { type: 'called' | 'completed'; toolName: string; args?: unknown; result?: string };
}

interface SessionUpdatedPayload {
  sessionId: string;
  agentName?: string;
  createdAt?: string;
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string; createdAt?: string; meta?: unknown }>;
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
  status: 'done' | 'error';
  summary: string;
}

export default function RuntimeSync() {
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
        status: 'running',
      });
    };

    const onWorkerCompleted = (data: WorkerCompletedPayload) => {
      useRosterStore.getState().setWorkerStatus(data.sessionId, data.taskId, data.status);
    };

    socket.on('session:updated', onSessionUpdated);
    socket.on('agent:tool', onTool);
    socket.on('agent:started', onAgentStarted);
    socket.on('agent:completed', onAgentDone);
    socket.on('agent:error', onAgentDone);
    socket.on('worker:spawned', onWorkerSpawned);
    socket.on('worker:completed', onWorkerCompleted);

    return () => {
      socket.off('session:updated', onSessionUpdated);
      socket.off('agent:tool', onTool);
      socket.off('agent:started', onAgentStarted);
      socket.off('agent:completed', onAgentDone);
      socket.off('agent:error', onAgentDone);
      socket.off('worker:spawned', onWorkerSpawned);
      socket.off('worker:completed', onWorkerCompleted);
    };
  }, []);

  return null;
}
