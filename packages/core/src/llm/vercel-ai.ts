import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText, tool } from "ai";
import type { Message } from "../agent/types.js";
import type { Config } from "../config.js";
import { createLogger } from "../contracts/logging.js";
import type { ProviderTarget } from "../provider-registry.js";
import { ProviderRuntimeState } from "../provider-runtime.js";
import type { LLMChatParams, LLMClient, LLMResponse } from "./client.js";

const logger = createLogger("core.llm.provider-router");

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

export function createVercelAILLMClient(
  config: Config,
  providerRuntime: ProviderRuntimeState = new ProviderRuntimeState(config),
): LLMClient {
  return {
    async chat(params: LLMChatParams): Promise<LLMResponse> {
      const eligibleTargets = providerRuntime.registry.resolveTargets(
        params.model,
        params.preferredProviderId,
      );
      if (eligibleTargets.length === 0) {
        throw new Error(`No eligible provider found for model ${params.model}`);
      }

      const system = buildSystem(params);
      const messages = convertMessages(params.messages);
      const tools = buildTools(params);

      let lastError: Error | null = null;
      let attempt = 0;

      const estimatedTokens = estimateAdmissionTokens(params);
      for (const target of eligibleTargets) {
        const { provider } = target;
        if (providerRuntime.isCircuitOpen(provider.id)) continue;

        const admissionError = reserveTarget(providerRuntime, target, estimatedTokens);
        if (admissionError) {
          lastError = admissionError;
          attempt++;
          continue;
        }

        try {
          if (attempt > 0) {
            // Exponential backoff before fallback (e.g. 1s, 2s...)
            const backoff = Math.min(2 ** (attempt - 1) * 1000, 5000);
            await delay(backoff, params.signal);
          }

          const response = await invokeProvider(target, params, system, messages, tools);

          providerRuntime.closeCircuit(provider.id);
          return response;
        } catch (error: unknown) {
          lastError = recordTransientFailure(providerRuntime, target, params, error);
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

function reserveTarget(
  providerRuntime: ProviderRuntimeState,
  target: ProviderTarget,
  estimatedTokens: number,
): ProviderRateLimitError | undefined {
  const admission = providerRuntime.reserve(target.provider, estimatedTokens);
  if (admission.allowed) return undefined;
  logger.warn("Configured provider rate limit denied attempt; trying fallback", {
    providerId: target.provider.id,
    model: target.modelId,
    limit: admission.reason,
    retryAfterMs: admission.retryAfterMs,
  });
  return new ProviderRateLimitError(target.provider.id, admission.reason, admission.retryAfterMs);
}

function recordTransientFailure(
  providerRuntime: ProviderRuntimeState,
  target: ProviderTarget,
  params: LLMChatParams,
  error: unknown,
): Error {
  if (params.signal?.aborted || isAbortError(error)) throw error;
  if (!isTransientProviderError(error)) throw error;
  const normalized = error instanceof Error ? error : new Error(String(error));
  providerRuntime.openCircuit(target.provider.id);
  logger.warn("Transient provider failure; opening circuit and trying fallback", {
    providerId: target.provider.id,
    model: target.modelId,
    statusCode: getStatusCode(error),
  });
  return normalized;
}

function buildSystem(params: LLMChatParams): string | undefined {
  const parts = [
    params.system,
    ...params.messages
      .filter((message) => message.role === "system")
      .map((message) => message.content),
  ].filter((part): part is string => typeof part === "string" && part.trim().length > 0);
  return parts.length > 0 ? parts.join("\n\n") : undefined;
}

function buildTools(params: LLMChatParams) {
  if (!params.tools) return undefined;
  return Object.fromEntries(
    params.tools.map((entry) => [
      entry.name,
      tool({ description: entry.description, inputSchema: entry.parameters }),
    ]),
  );
}

async function invokeProvider(
  target: ProviderTarget,
  params: LLMChatParams,
  system: string | undefined,
  messages: ReturnType<typeof convertMessages>,
  tools: ReturnType<typeof buildTools>,
): Promise<LLMResponse> {
  const apiKey = process.env[target.provider.apiKeyEnv] ?? "";
  const model =
    target.protocol === "anthropic"
      ? createAnthropic({ baseURL: target.provider.baseUrl, apiKey })(target.modelId)
      : createOpenAI({ baseURL: target.provider.baseUrl, apiKey }).chat(target.modelId);
  const result = await generateText({
    model,
    messages,
    ...(system ? { system } : {}),
    ...(tools ? { tools } : {}),
    ...(params.maxOutputTokens ? { maxOutputTokens: params.maxOutputTokens } : {}),
    ...(params.signal ? { abortSignal: params.signal } : {}),
  });
  const resultRecord = optionalRecord(result);
  const rawReasoning = resultRecord.reasoning ?? resultRecord.reasoning_content;
  const reasoning = typeof rawReasoning === "string" ? rawReasoning : undefined;
  const toolCalls = result.toolCalls?.length
    ? result.toolCalls.map((call) => ({
        toolCallId: call.toolCallId,
        toolName: call.toolName,
        args: requireRecord(call.input, `tool call ${call.toolCallId} args`),
      }))
    : undefined;
  const message: Message = {
    role: "assistant",
    content: result.text || "",
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
}

class ProviderRateLimitError extends Error {
  readonly statusCode = 429;

  constructor(
    providerId: string,
    limit: "requests" | "tokens",
    readonly retryAfterMs: number,
  ) {
    super(`Configured ${limit} rate limit exceeded for provider ${providerId}`);
    this.name = "ProviderRateLimitError";
  }
}

function estimateAdmissionTokens(params: LLMChatParams): number {
  const characters =
    (params.system?.length ?? 0) +
    JSON.stringify(params.messages).length +
    (params.tools?.reduce((total, entry) => total + JSON.stringify(entry).length, 0) ?? 0);
  return Math.max(1, Math.ceil(characters / 4)) + (params.maxOutputTokens ?? 4096);
}

function getStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined;
  const statusCode = error.statusCode ?? error.status;
  return typeof statusCode === "number" ? statusCode : undefined;
}

function isTransientProviderError(error: unknown): boolean {
  const statusCode = getStatusCode(error);
  return statusCode === 429 || (statusCode !== undefined && statusCode >= 500 && statusCode < 600);
}

function isAbortError(error: unknown): boolean {
  return isRecord(error) && error.name === "AbortError";
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
