import { z } from "zod";
import { MessageSchema, TaskIdSchema } from "./agent.js";

export const SessionIdSchema = TaskIdSchema;
export type SessionId = z.infer<typeof SessionIdSchema>;

export const PendingMessageSchema = z
  .object({
    taskId: TaskIdSchema,
    from: z.string().min(1).max(256),
    agentName: z.string().min(1).max(128),
    status: z.enum(["done", "error", "cancelled"]),
    summary: z.string().max(1_000_000),
    receivedAt: z.string().datetime(),
  })
  .strict();
export type PendingMessage = z.infer<typeof PendingMessageSchema>;

export const SessionDataSchema = z
  .object({
    sessionId: SessionIdSchema,
    taskId: TaskIdSchema,
    prompt: z.string().max(1_000_000),
    messages: z.array(MessageSchema).max(20_000),
    agentName: z.string().min(1).max(128).optional(),
    title: z.string().max(512).optional(),
    mailbox: z.array(PendingMessageSchema).max(10_000).optional(),
    result: z
      .object({
        status: z.enum([
          "running",
          "done",
          "success",
          "error",
          "cancelled",
          "maxStepsReached",
          "budgetExceeded",
        ]),
        summary: z.string().max(1_000_000),
      })
      .strict()
      .optional(),
    createdAt: z.string().datetime(),
    completedAt: z.string().datetime().optional(),
  })
  .strict();
export type SessionData = z.infer<typeof SessionDataSchema>;

export function createSessionData(overrides: Partial<SessionData> = {}): SessionData {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    taskId: overrides.taskId ?? "task-1",
    prompt: overrides.prompt ?? "test prompt",
    agentName: overrides.agentName ?? "orchestrator",
    messages: overrides.messages ?? [],
    createdAt: overrides.createdAt ?? new Date().toISOString(),
    ...overrides,
  };
}
