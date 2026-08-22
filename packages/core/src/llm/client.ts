import { z } from "zod";
import { AssistantMessageSchema, type Message, ToolCallSchema } from "../agent/types.js";

export interface LLMToolDefinition {
  name: string;
  description: string;
  parameters: z.ZodType;
}

export interface LLMChatParams {
  messages: Message[];
  system?: string;
  model: string;
  preferredProviderId?: string;
  tools?: LLMToolDefinition[];
  maxOutputTokens?: number;
  promptCaching?: boolean;
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

export const LLMFinishReasonSchema = z.enum([
  "stop",
  "tool-calls",
  "length",
  "content-filter",
  "error",
  "other",
]);
export type LLMFinishReason = z.infer<typeof LLMFinishReasonSchema>;

export const LLMResponseSchema = z
  .object({
    message: AssistantMessageSchema,
    finishReason: LLMFinishReasonSchema,
    toolCalls: z.array(ToolCallSchema).max(10_000).optional(),
    usage: LLMUsageSchema.optional(),
  })
  .strict()
  .superRefine((response, context) => {
    const toolCalls = response.toolCalls ?? response.message.toolCalls ?? [];
    if (response.finishReason === "tool-calls" && toolCalls.length === 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["toolCalls"],
        message: "tool-calls finish reason requires at least one tool call",
      });
    }
    if (response.finishReason !== "tool-calls" && toolCalls.length > 0) {
      context.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["finishReason"],
        message: "tool calls require the tool-calls finish reason",
      });
    }
  });
export type LLMResponse = z.infer<typeof LLMResponseSchema>;

export type LLMStreamDelta =
  | { type: "text-delta"; text: string }
  | { type: "tool-call-delta"; toolCall: { id: string; name: string; argumentsDelta: string } }
  | { type: "finish"; finishReason: LLMFinishReason; usage?: LLMUsage };

export interface LLMClient {
  chat(params: LLMChatParams): Promise<LLMResponse>;
  chatStream?(params: LLMChatParams): AsyncIterable<LLMStreamDelta>;
}
