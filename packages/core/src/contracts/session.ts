import { z } from "zod";
import { MessageSchema, TaskIdSchema } from "./agent.js";

export const PendingMessageSchema = z.object({
  taskId: TaskIdSchema,
  from: z.string().min(1).max(256),
  agentName: z.string().min(1).max(128),
  status: z.enum(["done", "error", "cancelled"]),
  summary: z.string(),
  receivedAt: z.string().min(1),
});
export type PendingMessage = z.infer<typeof PendingMessageSchema>;

export const SessionDataSchema = z.object({
  sessionId: z.string().min(1).max(256),
  taskId: TaskIdSchema,
  prompt: z.string(),
  messages: z.array(MessageSchema),
  agentName: z.string().min(1).max(128).optional(),
  title: z.string().max(512).optional(),
  mailbox: z.array(PendingMessageSchema).optional(),
  result: z
    .object({
      status: z.string().min(1).max(64),
      summary: z.string(),
    })
    .optional(),
  createdAt: z.string().min(1),
  completedAt: z.string().min(1).optional(),
});
export type SessionData = z.infer<typeof SessionDataSchema>;
