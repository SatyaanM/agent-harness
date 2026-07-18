import type { Server as SocketIOServer } from "socket.io";

export type AgentEventType = "agent:started" | "agent:completed" | "agent:error";

export interface AgentStartedPayload {
  sessionId: string;
  agentName: string;
}

export interface AgentCompletedPayload {
  sessionId: string;
  agentName: string;
  status: string;
}

export interface AgentErrorPayload {
  sessionId: string;
  error: string;
}

export type AgentEventPayload = AgentStartedPayload | AgentCompletedPayload | AgentErrorPayload;

let io: SocketIOServer | null = null;

export function initWebSocket(ioInstance: SocketIOServer): void {
  io = ioInstance;
}

export function emitAgentEvent(event: "agent:started", payload: AgentStartedPayload): void;
export function emitAgentEvent(event: "agent:completed", payload: AgentCompletedPayload): void;
export function emitAgentEvent(event: "agent:error", payload: AgentErrorPayload): void;
export function emitAgentEvent(event: AgentEventType, payload: AgentEventPayload): void {
  io?.emit(event, payload);
}
