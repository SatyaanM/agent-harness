import type { z } from "zod";

export type TaskId = string;

export interface AgentConfig {
  name: string;
  model: string;
  tools: string[];
  maxSteps: number;
  instructions: string;
  capabilities?: CapabilityMatrix;
  modelIdMapping?: string;
}

export interface CapabilityMatrix {
  chat: boolean;
  tools: boolean;
  vision: boolean;
  streaming: boolean;
  maxTokens: number;
}

export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  toolCalls?: ToolCall[];
  toolCallId?: string;
  createdAt?: string;
}

export interface ToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface AgentResult {
  status: "success" | "error" | "cancelled" | "maxStepsReached";
  summary: string;
  messages: Message[];
}
