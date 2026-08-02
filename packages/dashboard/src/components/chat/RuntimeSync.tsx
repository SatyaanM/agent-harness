'use client';

import { useEffect } from 'react';
import { useSessionStore } from '@/stores/session-store';
import { useRuntimeStore } from '@/stores/runtime-store';
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

    socket.on('session:updated', onSessionUpdated);
    socket.on('agent:tool', onTool);

    return () => {
      socket.off('session:updated', onSessionUpdated);
      socket.off('agent:tool', onTool);
    };
  }, []);

  return null;
}
