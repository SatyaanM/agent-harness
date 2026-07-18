import type { z } from "zod";
import type { Message, ToolCall } from "../agent/types.js";

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
}

export interface LLMResponse {
  message: Message;
  finishReason: "stop" | "tool-calls";
  toolCalls?: ToolCall[];
}

export interface LLMClient {
  chat(params: LLMChatParams): Promise<LLMResponse>;
}
