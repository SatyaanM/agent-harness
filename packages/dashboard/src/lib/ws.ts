"use client";

import { parseBoundary, SessionDataSchema } from "@agent-harness/core/contracts";
import { io, type Socket } from "socket.io-client";
import { z } from "zod";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

let socket: Socket | null = null;

const SessionIdentifierSchema = z.string().min(1).max(128);
export const SessionUpdatedEventSchema = SessionDataSchema;
export const ToolEventSchema = z.object({
  sessionId: SessionIdentifierSchema,
  agentName: z.string().min(1).max(128),
  tool: z.object({
    type: z.enum(["called", "completed"]),
    toolName: z.string().min(1).max(128),
    args: z.unknown().optional(),
    result: z.string().optional(),
  }),
});
export const AgentLifecycleEventSchema = z
  .object({ sessionId: SessionIdentifierSchema })
  .passthrough();
export const WorkerSpawnedEventSchema = z.object({
  sessionId: SessionIdentifierSchema,
  taskId: SessionIdentifierSchema,
  workerSessionId: SessionIdentifierSchema,
  task: z.string(),
});
export const WorkerCompletedEventSchema = z.object({
  sessionId: SessionIdentifierSchema,
  taskId: SessionIdentifierSchema,
  agentName: z.string().min(1).max(128),
  status: z.enum(["done", "error", "cancelled"]),
  summary: z.string(),
});

export function connectSocket(): Socket {
  if (!socket) {
    socket = io(BASE_URL, { transports: ["websocket"] });
  }
  return socket;
}

export function validatedEventHandler<TSchema extends z.ZodTypeAny>(
  schema: TSchema,
  boundary: string,
  handler: (value: z.output<TSchema>) => void,
  onInvalid: (error: unknown) => void = (error) =>
    console.error(`[WebSocket] Rejected ${boundary}:`, error),
): (value: unknown) => void {
  return (value) => {
    try {
      handler(parseBoundary(schema, value, boundary));
    } catch (error) {
      onInvalid(error);
    }
  };
}
