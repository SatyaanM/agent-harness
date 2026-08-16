import type { SessionData } from "@agent-harness/core";
import type { Server as SocketIOServer } from "socket.io";

export type AgentEventType =
  | "agent:started"
  | "agent:completed"
  | "agent:error"
  | "agent:tool"
  | "worker:spawned"
  | "worker:completed"
  | "session:updated";

export interface AgentStartedPayload {
  sessionId: string;
  agentName: string;
  runId?: string;
  requestId?: string;
}

export interface AgentCompletedPayload {
  sessionId: string;
  agentName: string;
  status: string;
  runId?: string;
  requestId?: string;
}

export interface AgentErrorPayload {
  sessionId: string;
  agentName?: string;
  error: string;
  code?: string;
  runId?: string;
  requestId?: string;
}

export interface AgentToolPayload {
  sessionId: string;
  agentName: string;
  tool: {
    type: "called" | "completed";
    toolName: string;
    args?: unknown;
    result?: string;
  };
  runId?: string;
  requestId?: string;
}

export interface WorkerSpawnedPayload {
  sessionId: string;
  taskId: string;
  workerSessionId: string;
  task: string;
}

export interface WorkerCompletedPayload {
  sessionId: string;
  taskId: string;
  agentName: string;
  status: "done" | "error" | "cancelled";
  summary: string;
}

export interface SessionUpdatedPayload extends SessionData {}

export type AgentEventPayload =
  | AgentStartedPayload
  | AgentCompletedPayload
  | AgentErrorPayload
  | AgentToolPayload
  | WorkerSpawnedPayload
  | WorkerCompletedPayload
  | SessionUpdatedPayload;

let io: SocketIOServer | null = null;

export function initWebSocket(ioInstance: SocketIOServer): void {
  io = ioInstance;
}

export function emitAgentEvent(event: "agent:started", payload: AgentStartedPayload): void;
export function emitAgentEvent(event: "agent:completed", payload: AgentCompletedPayload): void;
export function emitAgentEvent(event: "agent:error", payload: AgentErrorPayload): void;
export function emitAgentEvent(event: "agent:tool", payload: AgentToolPayload): void;
export function emitAgentEvent(event: "worker:spawned", payload: WorkerSpawnedPayload): void;
export function emitAgentEvent(event: "worker:completed", payload: WorkerCompletedPayload): void;
export function emitAgentEvent(event: "session:updated", payload: SessionUpdatedPayload): void;
export function emitAgentEvent(event: AgentEventType, payload: AgentEventPayload): void {
  io?.emit(event, payload);
}
