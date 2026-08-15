import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
import type { Message } from "../agent/types.js";
import type { Config } from "../config.js";
import type { LLMChatParams, LLMClient, LLMResponse } from "./client.js";

// Models that use Anthropic-compatible endpoint
const ANTHROPIC_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

function getModelProvider(modelId: string, config: Config) {
  // Strip "opencode-go/" prefix if present
  const cleanModelId = modelId.startsWith("opencode-go/")
    ? modelId.slice("opencode-go/".length)
    : modelId;

  const isAnthropic = ANTHROPIC_MODELS.has(cleanModelId);

  if (isAnthropic) {
    const apiKey = process.env[config.API_KEY_ENV] ?? "";
    const provider = createAnthropic({
      baseURL: config.PROVIDER_ENDPOINT,
      apiKey,
    });
    return { model: provider(cleanModelId), isAnthropic: true };
  } else {
    const apiKey = process.env[config.API_KEY_ENV] ?? "";
    const provider = createOpenAI({
      baseURL: config.PROVIDER_ENDPOINT,
      apiKey,
    });
    return { model: provider.chat(cleanModelId), isAnthropic: false };
  }
}

export function createVercelAILLMClient(config: Config): LLMClient {
  return {
    async chat(params: LLMChatParams): Promise<LLMResponse> {
      const { model } = getModelProvider(params.model, config);

      const systemParts = [
        params.system,
        ...params.messages.filter((m) => m.role === "system").map((m) => m.content),
      ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const instructions = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

      const messages = convertMessages(params.messages);

      const tools = params.tools
        ? Object.fromEntries(
            params.tools.map((t) => [
              t.name,
              {
                description: t.description,
                inputSchema: t.parameters,
              },
            ]),
          )
        : undefined;

      const result = await generateText({
        model,
        messages,
        ...(instructions ? { instructions } : {}),
        ...(tools ? { tools } : {}),
        ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
        ...(params.signal ? { abortSignal: params.signal } : {}),
      });
      const resultWithReasoning = optionalRecord(result);

      // Handle reasoning models: extract text from reasoning if content is empty
      let responseText = result.text;
      const rawReasoning = resultWithReasoning.reasoning ?? resultWithReasoning.reasoning_content;
      const reasoning = typeof rawReasoning === "string" ? rawReasoning : undefined;
      if (!responseText || responseText.trim().length === 0) {
        if (reasoning) {
          responseText = reasoning;
        }
      }

      const toolCalls = result.toolCalls?.length
        ? result.toolCalls.map((tc) => ({
            toolCallId: tc.toolCallId,
            toolName: tc.toolName,
            args: requireRecord(tc.input, `tool call ${tc.toolCallId} input`),
          }))
        : undefined;

      const message: Message = {
        role: "assistant",
        content: responseText || "",
        ...(reasoning ? { reasoning } : {}),
        ...(toolCalls ? { toolCalls } : {}),
      };

      return {
        message,
        finishReason: result.finishReason === "tool-calls" ? "tool-calls" : "stop",
        ...(toolCalls ? { toolCalls } : {}),
        usage: {
          inputTokens: result.usage.inputTokens,
          outputTokens: result.usage.outputTokens,
          totalTokens: result.usage.totalTokens,
        },
      };
    },
  };
}

function optionalRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {};
}

function requireRecord(value: unknown, boundary: string): Record<string, unknown> {
  if (!isRecord(value)) {
    throw new Error(`Invalid provider response: ${boundary} must be an object`);
  }
  return value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function convertMessages(messages: Message[]) {
  return messages
    .filter((msg) => msg.role !== "system")
    .map((msg, index, arr) => {
      switch (msg.role) {
        case "user":
          return { role: "user" as const, content: msg.content };

        case "assistant":
          if (msg.toolCalls?.length) {
            return {
              role: "assistant" as const,
              content: [
                { type: "text" as const, text: msg.content || "" },
                ...msg.toolCalls.map((tc) => ({
                  type: "tool-call" as const,
                  toolCallId: tc.toolCallId,
                  toolName: tc.toolName,
                  input: tc.args,
                })),
              ],
            };
          }
          return { role: "assistant" as const, content: msg.content };

        case "tool": {
          if (!msg.toolCallId) {
            throw new Error("Tool messages must include a toolCallId");
          }
          const toolCallId = msg.toolCallId;
          const toolName = findToolName(toolCallId, arr.slice(0, index));
          return {
            role: "tool" as const,
            content: [
              {
                type: "tool-result" as const,
                toolCallId,
                toolName: toolName ?? "unknown",
                output: {
                  type: "text" as const,
                  value: msg.content,
                },
              },
            ],
          };
        }

        default:
          return { role: "user" as const, content: msg.content };
      }
    });
}

function findToolName(toolCallId: string, messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tc = messages[i].toolCalls?.find((c) => c.toolCallId === toolCallId);
    if (tc) return tc.toolName;
  }
  return undefined;
}
