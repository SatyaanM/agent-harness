import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import type { Message } from "../agent/types.js";
import type { Config } from "../config.js";
import { ProviderRegistry } from "../provider-registry.js";
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

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        reject(signal.reason);
      },
      { once: true },
    );
  });
}

export function createVercelAILLMClient(config: Config): LLMClient {
  const registry = new ProviderRegistry(config);
  // Circuit breaker state: provider id -> timestamp when it opens (fails)
  const openProviders = new Map<string, number>();
  const CIRCUIT_OPEN_DURATION_MS = 60 * 1000; // 1 minute

  return {
    async chat(params: LLMChatParams): Promise<LLMResponse> {
      const cleanModelId = params.model.startsWith("opencode-go/")
        ? params.model.slice("opencode-go/".length)
        : params.model;

      const eligibleProviders = registry.resolveProvider(cleanModelId);
      if (eligibleProviders.length === 0) {
        throw new Error(`No eligible provider found for model ${cleanModelId}`);
      }

      const systemParts = [
        params.system,
        ...params.messages.filter((m) => m.role === "system").map((m) => m.content),
      ].filter((s): s is string => typeof s === "string" && s.trim().length > 0);
      const system = systemParts.length > 0 ? systemParts.join("\n\n") : undefined;

      const messages = convertMessages(params.messages);
      const tools = params.tools
        ? Object.fromEntries(
            params.tools.map((t) => [
              t.name,
              tool({
                description: t.description,
                inputSchema: t.parameters,
              }),
            ]),
          )
        : undefined;

      let lastError: Error | null = null;
      let attempt = 0;

      for (const provider of eligibleProviders) {
        // Check circuit breaker
        const openedAt = openProviders.get(provider.id);
        if (openedAt && Date.now() - openedAt < CIRCUIT_OPEN_DURATION_MS) {
          continue; // Skip open provider
        }

        const apiKey = process.env[provider.apiKeyEnv] ?? "";
        const isAnthropic =
          provider.protocol === "anthropic" ||
          (provider.id === "default" && ANTHROPIC_MODELS.has(cleanModelId));

        const model = isAnthropic
          ? createAnthropic({ baseURL: provider.baseUrl, apiKey })(cleanModelId)
          : createOpenAI({ baseURL: provider.baseUrl, apiKey }).chat(cleanModelId);

        try {
          if (attempt > 0) {
            // Exponential backoff before fallback (e.g. 1s, 2s...)
            const backoff = Math.min(2 ** (attempt - 1) * 1000, 5000);
            await delay(backoff, params.signal);
          }

          const result = await generateText({
            model,
            messages,
            ...(system ? { system } : {}),
            ...(tools ? { tools } : {}),
            ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
            ...(params.signal ? { abortSignal: params.signal } : {}),
          });

          // Reset circuit breaker on success
          openProviders.delete(provider.id);

          const resultWithReasoning = optionalRecord(result);
          const responseText = result.text;
          const rawReasoning =
            resultWithReasoning.reasoning ?? resultWithReasoning.reasoning_content;
          const reasoning = typeof rawReasoning === "string" ? rawReasoning : undefined;
          const toolCalls = result.toolCalls?.length
            ? result.toolCalls.map((tc) => ({
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                args: requireRecord(tc.input, `tool call ${tc.toolCallId} args`),
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
            finishReason: mapFinishReason(result.finishReason),
            ...(toolCalls ? { toolCalls } : {}),
            usage: {
              inputTokens: result.usage.inputTokens,
              outputTokens: result.usage.outputTokens,
              totalTokens: result.usage.totalTokens,
            },
          };
        } catch (error: unknown) {
          lastError = error instanceof Error ? error : new Error(String(error));

          // Open circuit breaker if it's a 429 or 5xx
          const isRateLimitOrServerError =
            (isRecord(error) && error.statusCode === 429) ||
            (isRecord(error) &&
              typeof error.statusCode === "number" &&
              error.statusCode >= 500 &&
              error.statusCode < 600) ||
            (isRecord(error) && error.name === "APICallError");
          if (isRateLimitOrServerError) {
            openProviders.set(provider.id, Date.now());
          }
          attempt++;
        }
      }

      if (attempt === 0) {
        throw new Error(
          "All eligible providers are temporarily unavailable (circuit breakers open)",
        );
      }

      throw new Error(`All eligible providers failed. Last error: ${lastError?.message}`, {
        cause: lastError,
      });
    },
  };
}

function mapFinishReason(
  finishReason: string,
): "stop" | "tool-calls" | "length" | "content-filter" | "error" | "other" {
  switch (finishReason) {
    case "stop":
    case "tool-calls":
    case "length":
    case "content-filter":
    case "error":
      return finishReason;
    default:
      return "other";
  }
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
      }
      throw new Error("Unsupported message role");
    });
}

function findToolName(toolCallId: string, messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i];
    const tc = msg?.toolCalls?.find((c) => c.toolCallId === toolCallId);
    if (tc) return tc.toolName;
  }
  return undefined;
}
