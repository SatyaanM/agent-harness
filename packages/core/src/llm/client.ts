import { z } from "zod";
import { type Message, MessageSchema, ToolCallSchema } from "../agent/types.js";

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
}

export interface LLMChatParams {
  messages: Message[];
  system?: string;
  model: string;
  tools?: LLMToolDefinition[];
  maxOutputTokens?: number;
  signal?: AbortSignal;
}

export const LLMUsageSchema = z
  .object({
    inputTokens: z.number().int().nonnegative().max(100_000_000).optional(),
    outputTokens: z.number().int().nonnegative().max(100_000_000).optional(),
    totalTokens: z.number().int().nonnegative().max(100_000_000).optional(),
  })
  .strict();
export type LLMUsage = z.infer<typeof LLMUsageSchema>;

export const LLMResponseSchema = z
  .object({
    message: MessageSchema,
    finishReason: z.enum(["stop", "tool-calls"]),
    toolCalls: z.array(ToolCallSchema).max(10_000).optional(),
    usage: LLMUsageSchema.optional(),
  })
  .strict();
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export interface LLMClient {
  chat(params: LLMChatParams): Promise<LLMResponse>;
}
