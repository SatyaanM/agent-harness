import { z } from "zod";
import { MAX_SESSION_TRANSCRIPT_BYTES } from "./limits.js";

export const TaskIdSchema = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/u);
export type TaskId = z.infer<typeof TaskIdSchema>;

export const CapabilityMatrixSchema = z
  .object({
    chat: z.boolean(),
    tools: z.boolean(),
    vision: z.boolean(),
    streaming: z.boolean(),
    maxTokens: z.number().int().nonnegative().max(10_000_000),
  })
  .strict();
export type CapabilityMatrix = z.infer<typeof CapabilityMatrixSchema>;

export const AgentConfigSchema = z
  .object({
    name: z.string().min(1).max(128),
    model: z.string().min(1).max(256),
    tools: z.array(z.string().min(1).max(128)).max(128),
    maxSteps: z.number().int().positive().max(1_000),
    maxToolCalls: z.number().int().positive().max(10_000).optional(),
    maxToolResultChars: z.number().int().min(256).max(1_000_000).optional(),
    maxOutputTokens: z.number().int().positive().max(100_000).optional(),
    maxTotalTokens: z.number().int().positive().max(10_000_000).optional(),
    runTimeoutMs: z.number().int().min(1_000).max(3_600_000).optional(),
    instructions: z.string().max(1_000_000),
    description: z.string().max(10_000).optional(),
    capabilities: CapabilityMatrixSchema.optional(),
    modelIdMapping: z.string().max(256).optional(),
  })
  .strict();
export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export const ToolCallSchema = z
  .object({
    toolCallId: z.string().min(1).max(256),
    toolName: z.string().min(1).max(128),
    args: z
      .record(z.unknown())
      .refine((value) => hasBoundedSerializedLength(value, 1_000_000), "arguments are too large"),
  })
  .strict();
export type ToolCall = z.infer<typeof ToolCallSchema>;

export const MessageSchema = z
  .object({
    role: z.enum(["system", "user", "assistant", "tool"]),
    content: z.string().max(MAX_SESSION_TRANSCRIPT_BYTES),
    reasoning: z.string().max(1_000_000).optional(),
    meta: z.unknown().optional(),
    toolCalls: z.array(ToolCallSchema).max(10_000).optional(),
    toolCallId: z.string().min(1).max(256).optional(),
    createdAt: z.string().datetime().optional(),
  })
  .strict()
  .superRefine((message, context) => {
    if (message.role === "tool" || message.content.length <= 1_000_000) return;
    context.addIssue({
      code: z.ZodIssueCode.too_big,
      maximum: 1_000_000,
      type: "string",
      inclusive: true,
      exact: false,
      path: ["content"],
      message: "non-tool message content exceeds 1000000 characters",
    });
  });
export type Message = z.infer<typeof MessageSchema>;

export const AgentResultSchema = z
  .object({
    status: z.enum(["success", "error", "cancelled", "maxStepsReached", "budgetExceeded"]),
    summary: z.string().max(1_000_000),
    messages: z.array(MessageSchema).max(20_000),
  })
  .strict();
export type AgentResult = z.infer<typeof AgentResultSchema>;

function hasBoundedSerializedLength(value: unknown, maxCharacters: number): boolean {
  try {
    const serialized = JSON.stringify(value);
    return serialized !== undefined && serialized.length <= maxCharacters;
  } catch {
    return false;
  }
}
