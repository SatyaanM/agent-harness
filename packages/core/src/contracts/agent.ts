import { z } from "zod";

export const TaskIdSchema = z.string().min(1).max(128);
export type TaskId = z.infer<typeof TaskIdSchema>;

export const CapabilityMatrixSchema = z.object({
  chat: z.boolean(),
  tools: z.boolean(),
  vision: z.boolean(),
  streaming: z.boolean(),
  maxTokens: z.number().int().positive(),
});
export type CapabilityMatrix = z.infer<typeof CapabilityMatrixSchema>;

export const AgentConfigSchema = z.object({
  name: z.string().min(1).max(128),
  model: z.string().min(1).max(256),
  tools: z.array(z.string().min(1).max(128)).max(128),
  maxSteps: z.number().int().positive().max(1_000),
  instructions: z.string().max(1_000_000),
  description: z.string().max(10_000).optional(),
  capabilities: CapabilityMatrixSchema.optional(),
  modelIdMapping: z.string().max(256).optional(),
});
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ToolCallSchema = z.object({
  toolCallId: z.string().min(1).max(256),
  toolName: z.string().min(1).max(128),
  args: z.record(z.unknown()),
});
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const MessageSchema = z.object({
  role: z.enum(["system", "user", "assistant", "tool"]),
  content: z.string(),
  reasoning: z.string().optional(),
  meta: z.unknown().optional(),
  toolCalls: z.array(ToolCallSchema).optional(),
  toolCallId: z.string().min(1).max(256).optional(),
  createdAt: z.string().min(1).optional(),
});
export type Message = z.infer<typeof MessageSchema>;

export const AgentResultSchema = z.object({
  status: z.enum(["success", "error", "cancelled", "maxStepsReached"]),
  summary: z.string(),
  messages: z.array(MessageSchema),
});
export type AgentResult = z.infer<typeof AgentResultSchema>;
