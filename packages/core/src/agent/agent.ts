import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import {
  MAX_STREAM_DELTA_BYTES,
  MAX_STREAM_REASONING_CHARS,
  MAX_STREAM_TEXT_CHARS,
  MAX_STREAM_TOOL_ARGUMENT_CHARS,
  MAX_STREAM_TOOL_CALL_ID_BYTES,
  MAX_STREAM_TOOL_NAME_BYTES,
  MAX_STREAM_TOTAL_DELTA_BYTES,
} from "../contracts/streaming.js";
import { getTracer, SpanKind, SpanStatusCode } from "../contracts/tracing.js";
import {
  type LLMClient,
  type LLMFinishReason,
  type LLMResponse,
  LLMResponseSchema,
  type LLMToolDefinition,
  type LLMUsage,
} from "../llm/client.js";

import type { ToolRegistry } from "../tool/types.js";
import { parseBoundary } from "../validation.js";

import {
  AgentBudgetExceededError,
  AgentCancelledError,
  type AgentConfig,
  AgentConfigSchema,
  type AgentResult,
  type CapabilityMatrix,
  type Message,
} from "./types.js";

const DEFAULT_MAX_TOOL_CALLS = 64;
const DEFAULT_MAX_TOOL_RESULT_CHARS = 100_000;
const DEFAULT_MAX_OUTPUT_TOKENS = 4_096;
const DEFAULT_MAX_TOTAL_TOKENS = 100_000;
const DEFAULT_RUN_TIMEOUT_MS = 300_000;
const STREAM_ITERATOR_CLEANUP_TIMEOUT_MS = 100;

export type AgentEventCallback = (
  event:
    | { type: "tool:called"; toolName: string; args?: Record<string, unknown> }
    | { type: "tool:completed"; toolName: string; result?: string }
    | { type: "step"; messages: Message[] }
    | { type: "capability-mismatch"; detail: string }
    | { type: "text-delta"; text: string }
    | { type: "tool-call-delta"; toolCall: { id: string; name: string; argumentsDelta: string } }
    | { type: "stream-metrics"; metrics: StreamPerformanceMetrics },
) => void;

export interface StreamPerformanceMetrics {
  ttftMs: number | null;
  tokensPerSecond: number | null;
  outputTokens: number;
  durationMs: number;
}

export class Agent {
  private messages: Message[] = [];
  private readonly config: AgentConfig;

  constructor(
    config: AgentConfig,
    private readonly toolRegistry: ToolRegistry,
    private readonly llmClient: LLMClient,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly onEvent?: AgentEventCallback,
    private readonly logger: Logger = createLogger("core.agent"),
  ) {
    this.config = parseBoundary(AgentConfigSchema, config, "agent configuration");
  }

  async run(
    prompt?: string,
    history: Message[] = [],
    signal?: AbortSignal,
    resolvedCapabilities?: CapabilityMatrix,
  ): Promise<AgentResult> {
    const tracer = getTracer();
    const runSpan = tracer.startSpan("agent.run", {
      attributes: {
        "agent.name": this.config.name,
        "agent.model": this.config.model,
        "agent.max_steps": this.config.maxSteps,
      },
    });

    const timeoutController = new AbortController();
    const timeoutMs = this.config.runTimeoutMs ?? DEFAULT_RUN_TIMEOUT_MS;
    const timeout = setTimeout(() => timeoutController.abort(), timeoutMs);
    const runSignal = signal
      ? AbortSignal.any([signal, timeoutController.signal])
      : timeoutController.signal;
    try {
      const result = await tracer.withSpan(runSpan, async () => {
        return await this.runWithSignal(prompt, history, runSignal, resolvedCapabilities);
      });
      runSpan.setStatus({
        code: result.status === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      return result;
    } catch (error) {
      if (signal?.aborted) {
        runSpan.setStatus({ code: SpanStatusCode.OK, message: "Cancelled by user" });
        throw new AgentCancelledError();
      }
      if (timeoutController.signal.aborted) {
        runSpan.recordException(error);
        runSpan.setStatus({
          code: SpanStatusCode.ERROR,
          message: `Agent run exceeded ${timeoutMs}ms deadline`,
        });
        throw new AgentBudgetExceededError(`Agent run exceeded ${timeoutMs}ms deadline`);
      }
      runSpan.recordException(error);
      runSpan.setStatus({
        code: SpanStatusCode.ERROR,
        message: error instanceof Error ? error.message : String(error),
      });
      throw error;
    } finally {
      clearTimeout(timeout);
      runSpan.end();
    }
  }

  private async runWithSignal(
    prompt: string | undefined,
    history: Message[],
    signal: AbortSignal,
    resolvedCapabilities: CapabilityMatrix | undefined,
  ): Promise<AgentResult> {
    const tracer = getTracer();
    this.messages = [...history];
    if (prompt) {
      this.messages.push({ role: "user", content: prompt });
    }

    const matrix = resolvedCapabilities ?? (await this.resolveCapabilities());

    const tools = this.config.tools
      .map((name) => this.toolRegistry.get(name))
      .filter((t): t is NonNullable<typeof t> => t != null);

    const eligibleTools = matrix.tools
      ? tools.filter((tool) => !tool.requiresHITL || matrix.reasoning)
      : [];
    const eligibleToolMap = new Map(eligibleTools.map((tool) => [tool.name, tool]));
    const llmTools: LLMToolDefinition[] | undefined = eligibleTools.length
      ? eligibleTools.map((tool) => ({
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        }))
      : undefined;

    const maxToolCalls = this.config.maxToolCalls ?? DEFAULT_MAX_TOOL_CALLS;
    const maxToolResultChars = this.config.maxToolResultChars ?? DEFAULT_MAX_TOOL_RESULT_CHARS;

    const configMax = this.config.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS;
    const maxOutputTokens =
      matrix.maxTokens && matrix.maxTokens > 0 ? Math.min(configMax, matrix.maxTokens) : configMax;

    const maxTotalTokens = this.config.maxTotalTokens ?? DEFAULT_MAX_TOTAL_TOKENS;
    let toolCallsUsed = 0;
    let totalTokensUsed = 0;

    for (let step = 0; step < this.config.maxSteps; step++) {
      if (signal.aborted) throw new AgentCancelledError();

      const stepSpan = tracer.startSpan("agent.step", {
        attributes: {
          "agent.step_index": step,
          "agent.name": this.config.name,
        },
      });

      try {
        const stepResult = await tracer.withSpan(stepSpan, async () => {
          const llmSpan = tracer.startSpan("gen_ai.chat", {
            kind: SpanKind.CLIENT,
            attributes: {
              "gen_ai.request.model": this.config.model,
              "gen_ai.request.max_tokens": maxOutputTokens,
            },
          });

          let finalSystem = this.config.instructions;
          if (!matrix.structuredOutputs && llmTools && llmTools.length > 0) {
            finalSystem +=
              "\n\nYou must strictly adhere to the provided JSON schemas for any tools you invoke.";
          }

          let finalMessages = projectToolResultsForModel(this.messages, maxToolResultChars);
          if (!matrix.vision) {
            finalMessages = finalMessages.map((msg) => ({
              ...msg,
              content: msg.content.replace(
                /!\[.*?\]\(.*?\)/g,
                "[Image omitted due to model capability]",
              ),
            }));
          }

          let response: LLMResponse;
          try {
            const chatParams = {
              messages: finalMessages,
              system: finalSystem,
              model: this.config.model,
              ...(this.config.provider ? { preferredProviderId: this.config.provider } : {}),
              ...(llmTools ? { tools: llmTools } : {}),
              maxOutputTokens,
              promptCaching: matrix.promptCaching,
              signal,
            };

            const rawResponse = await tracer.withSpan(llmSpan, async () => {
              if (matrix.streaming && this.llmClient.chatStream) {
                let text = "";
                let reasoning = "";
                const toolCallsMap = new Map<string, { name: string; argsText: string }>();
                let totalDeltaBytes = 0;
                let finishReason: LLMFinishReason | undefined;
                let usage: LLMUsage | undefined;
                const streamStartedAt = Date.now();
                let firstTokenAt: number | undefined;
                let finishedAt: number | undefined;
                let streamFailed = false;
                let streamFailure: unknown;
                const streamIterator = this.llmClient
                  .chatStream(chatParams)
                  [Symbol.asyncIterator]();

                try {
                  while (true) {
                    const next = await nextStreamChunk(streamIterator, signal);
                    if (next.done) break;
                    const chunk = next.value;
                    if (finishReason !== undefined) {
                      throw new Error(
                        `Provider stream emitted ${chunk.type} after terminal finish event`,
                      );
                    }
                    if (chunk.type === "text-delta") {
                      totalDeltaBytes = addStreamDeltaBytes(totalDeltaBytes, chunk.text);
                      if (text.length + chunk.text.length > MAX_STREAM_TEXT_CHARS) {
                        throw new Error(
                          `Provider streamed text limit exceeded (${MAX_STREAM_TEXT_CHARS} characters)`,
                        );
                      }
                      firstTokenAt ??= Date.now();
                      text += chunk.text;
                      this.onEvent?.(chunk);
                    } else if (chunk.type === "reasoning-delta") {
                      totalDeltaBytes = addStreamDeltaBytes(totalDeltaBytes, chunk.reasoning);
                      if (reasoning.length + chunk.reasoning.length > MAX_STREAM_REASONING_CHARS) {
                        throw new Error(
                          `Provider streamed reasoning limit exceeded (${MAX_STREAM_REASONING_CHARS} characters)`,
                        );
                      }
                      reasoning += chunk.reasoning;
                    } else if (chunk.type === "tool-call-delta") {
                      if (chunk.toolCall) {
                        ensureBoundedStreamField(
                          chunk.toolCall.id,
                          MAX_STREAM_TOOL_CALL_ID_BYTES,
                          "tool call id",
                        );
                        ensureBoundedStreamField(
                          chunk.toolCall.name,
                          MAX_STREAM_TOOL_NAME_BYTES,
                          "tool name",
                        );
                        totalDeltaBytes = addStreamDeltaBytes(totalDeltaBytes, chunk.toolCall.id);
                        totalDeltaBytes = addStreamDeltaBytes(totalDeltaBytes, chunk.toolCall.name);
                        totalDeltaBytes = addStreamDeltaBytes(
                          totalDeltaBytes,
                          chunk.toolCall.argumentsDelta,
                        );
                        const existing = toolCallsMap.get(chunk.toolCall.id) || {
                          name: chunk.toolCall.name,
                          argsText: "",
                        };
                        if (
                          !toolCallsMap.has(chunk.toolCall.id) &&
                          toolCallsMap.size >= maxToolCalls
                        ) {
                          throw new Error(
                            `Provider streamed tool-call count limit exceeded (${maxToolCalls})`,
                          );
                        }
                        if (
                          existing.argsText.length + chunk.toolCall.argumentsDelta.length >
                          MAX_STREAM_TOOL_ARGUMENT_CHARS
                        ) {
                          throw new Error(
                            `Provider streamed tool argument limit exceeded (${MAX_STREAM_TOOL_ARGUMENT_CHARS} characters)`,
                          );
                        }
                        existing.argsText += chunk.toolCall.argumentsDelta;
                        toolCallsMap.set(chunk.toolCall.id, existing);
                        this.onEvent?.(chunk);
                      }
                    } else if (chunk.type === "finish") {
                      finishReason = chunk.finishReason;
                      usage = chunk.usage;
                      finishedAt = Date.now();
                    }
                  }
                } catch (error) {
                  streamFailed = true;
                  streamFailure = error;
                  finishedAt = Date.now();
                } finally {
                  await closeStreamIterator(streamIterator);
                }

                finishedAt ??= Date.now();
                const outputTokens = usage?.outputTokens ?? Math.ceil(text.length / 4);
                const durationMs = Math.max(0, finishedAt - streamStartedAt);
                const generationMs =
                  firstTokenAt === undefined ? 0 : Math.max(0, finishedAt - firstTokenAt);
                const metrics: StreamPerformanceMetrics = {
                  ttftMs: firstTokenAt === undefined ? null : firstTokenAt - streamStartedAt,
                  tokensPerSecond:
                    firstTokenAt === undefined || outputTokens === 0
                      ? null
                      : outputTokens / Math.max(generationMs / 1_000, 0.001),
                  outputTokens,
                  durationMs,
                };
                llmSpan.setAttributes({
                  ...(metrics.ttftMs === null
                    ? {}
                    : { "gen_ai.performance.time_to_first_token_ms": metrics.ttftMs }),
                  ...(metrics.tokensPerSecond === null
                    ? {}
                    : {
                        "gen_ai.performance.output_tokens_per_second": metrics.tokensPerSecond,
                      }),
                });
                this.onEvent?.({ type: "stream-metrics", metrics });

                if (streamFailed) throw streamFailure;
                if (!finishReason) {
                  throw new Error("Provider stream ended without a terminal finish event");
                }

                const toolCalls = Array.from(toolCallsMap.entries()).map(([id, tc]) => {
                  try {
                    return { toolCallId: id, toolName: tc.name, args: JSON.parse(tc.argsText) };
                  } catch (err) {
                    throw new Error(
                      `Failed to parse tool call arguments for ${tc.name} (${id}): ${err instanceof Error ? err.message : String(err)}`,
                      { cause: err },
                    );
                  }
                });

                return {
                  message: {
                    role: "assistant",
                    content: text,
                    ...(reasoning ? { reasoning } : {}),
                    ...(toolCalls.length > 0 ? { toolCalls } : {}),
                  },
                  finishReason,
                  ...(toolCalls.length > 0 ? { toolCalls } : {}),
                  ...(usage ? { usage } : {}),
                };
              } else {
                return await this.llmClient.chat(chatParams);
              }
            });

            const parsed = parseBoundary(LLMResponseSchema, rawResponse, "provider response");
            llmSpan.setAttributes({
              "gen_ai.response.model": this.config.model,
              "gen_ai.response.finish_reasons": [parsed.finishReason],
            });

            if (parsed.usage) {
              llmSpan.setAttributes({
                "gen_ai.usage.input_tokens": parsed.usage.inputTokens,
                "gen_ai.usage.output_tokens": parsed.usage.outputTokens,
                "gen_ai.usage.total_tokens": parsed.usage.totalTokens,
              });
            }
            llmSpan.setStatus({ code: SpanStatusCode.OK });
            response = parsed;
          } catch (llmError) {
            llmSpan.recordException(llmError);
            llmSpan.setStatus({
              code: SpanStatusCode.ERROR,
              message: llmError instanceof Error ? llmError.message : String(llmError),
            });
            throw llmError;
          } finally {
            llmSpan.end();
          }

          if (signal.aborted) {
            throw new AgentCancelledError();
          }

          const providerToolCalls = response.toolCalls ?? response.message.toolCalls ?? [];
          const deniedToolCalls = providerToolCalls.filter(
            (toolCall) => !eligibleToolMap.has(toolCall.toolName),
          );
          const responseToolCalls = providerToolCalls.filter((toolCall) =>
            eligibleToolMap.has(toolCall.toolName),
          );
          let toolDenial: string | undefined;
          if (deniedToolCalls.length > 0) {
            const detail = !matrix.tools
              ? `Model returned ${deniedToolCalls.length} tool call(s) but tools capability is disabled`
              : `Model returned tool call(s) outside the eligible tool map: ${deniedToolCalls.map((call) => call.toolName).join(", ")}`;
            this.onEvent?.({
              type: "capability-mismatch",
              detail,
            });
            this.logger.warn("Capability mismatch", {
              capability: "tools",
              model: this.config.model,
              toolCallCount: deniedToolCalls.length,
              toolNames: deniedToolCalls.map((call) => call.toolName),
            });
            toolDenial = matrix.tools
              ? "One or more requested tools are not eligible for this agent run. Do not call unavailable, unconfigured, delegated, or approval-required tools; continue using only the provided tools or answer with text."
              : "Tool calls are disabled for this model. Do not call tools; answer using text only.";
          }

          const responseMessage = responseToolCalls.length
            ? { ...response.message, toolCalls: responseToolCalls }
            : stripToolCalls(response.message);
          this.messages.push(responseMessage);
          if (toolDenial && responseToolCalls.length === 0) {
            this.messages.push({
              role: "system",
              content: toolDenial,
            });
          }
          this.onEvent?.({ type: "step", messages: [...this.messages] });

          totalTokensUsed += tokenCharge(
            response,
            projectToolResultsForModel(this.messages, maxToolResultChars),
            this.config.instructions,
          );
          if (totalTokensUsed > maxTotalTokens) {
            if (responseToolCalls.length) {
              this.messages.push(
                ...responseToolCalls.map((toolCall) => ({
                  role: "tool" as const,
                  content: `Error: Agent token budget exceeded (${totalTokensUsed}/${maxTotalTokens}); tool was not executed.`,
                  toolCallId: toolCall.toolCallId,
                })),
              );
            }
            stepSpan.setStatus({ code: SpanStatusCode.ERROR });
            return this.budgetExceeded(
              `Agent token budget exceeded (${totalTokensUsed}/${maxTotalTokens}).`,
            );
          }

          if (response.finishReason === "stop") {
            stepSpan.setStatus({ code: SpanStatusCode.OK });
            return {
              status: "success" as const,
              summary: response.message.content,
              messages: [...this.messages],
            };
          }

          if (response.finishReason !== "tool-calls") {
            stepSpan.setStatus({ code: SpanStatusCode.ERROR });
            return {
              status: "error" as const,
              summary: `Provider stopped with finish reason ${response.finishReason}.`,
              messages: [...this.messages],
            };
          }

          if (responseToolCalls.length) {
            for (const [toolCallIndex, toolCall] of responseToolCalls.entries()) {
              if (signal.aborted) {
                throw new AgentCancelledError();
              }
              if (toolCallsUsed >= maxToolCalls) {
                this.messages.push(
                  ...responseToolCalls.slice(toolCallIndex).map((skipped) => ({
                    role: "tool" as const,
                    content: `Error: Agent tool-call budget exceeded (${maxToolCalls}).`,
                    toolCallId: skipped.toolCallId,
                  })),
                );
                stepSpan.setStatus({ code: SpanStatusCode.ERROR });
                return this.budgetExceeded(`Agent tool-call budget exceeded (${maxToolCalls}).`);
              }
              toolCallsUsed += 1;

              const tool = eligibleToolMap.get(toolCall.toolName);

              if (!tool) {
                this.messages.push({
                  role: "tool",
                  content: `Error: Tool "${toolCall.toolName}" not found`,
                  toolCallId: toolCall.toolCallId,
                });
                continue;
              }

              this.onEvent?.({
                type: "tool:called",
                toolName: toolCall.toolName,
                args: toolCall.args,
              });

              const toolSpan = tracer.startSpan(`tool.execute: ${toolCall.toolName}`, {
                kind: SpanKind.INTERNAL,
                attributes: {
                  "agent.tool.name": toolCall.toolName,
                  "agent.tool.call_id": toolCall.toolCallId,
                },
              });

              try {
                await tracer.withSpan(toolSpan, async () => {
                  const args = parseBoundary(
                    tool.parameters,
                    toolCall.args,
                    `tool ${toolCall.toolName} arguments`,
                  );
                  const result = await waitForAbort(tool.execute(args, { signal }), signal);
                  if (signal.aborted) {
                    throw new AgentCancelledError();
                  }
                  toolSpan.setStatus({ code: SpanStatusCode.OK });

                  this.onEvent?.({
                    type: "tool:completed",
                    toolName: toolCall.toolName,
                    result: boundToolResult(result, maxToolResultChars),
                  });
                  this.messages.push({
                    role: "tool",
                    content: result,
                    toolCallId: toolCall.toolCallId,
                  });
                });
              } catch (error) {
                toolSpan.recordException(error);
                toolSpan.setStatus({
                  code: SpanStatusCode.ERROR,
                  message: error instanceof Error ? error.message : String(error),
                });
                if (signal.aborted) {
                  throw new AgentCancelledError();
                }
                const errorMessage = error instanceof Error ? error.message : String(error);
                this.logger.error(`Tool "${toolCall.toolName}" failed`, {
                  toolName: toolCall.toolName,
                  ...describeError(error),
                });
                this.messages.push({
                  role: "tool",
                  content: `Error: ${errorMessage}`,
                  toolCallId: toolCall.toolCallId,
                });
              } finally {
                toolSpan.end();
              }
            }
            if (toolDenial) {
              this.messages.push({ role: "system", content: toolDenial });
            }
            this.onEvent?.({ type: "step", messages: [...this.messages] });
          }

          return undefined;
        });

        if (stepResult) {
          return stepResult;
        }
      } finally {
        stepSpan.end();
      }
    }

    const finalMessage = this.messages[this.messages.length - 1];
    return {
      status: "maxStepsReached",
      summary:
        finalMessage?.role === "tool"
          ? boundToolResult(finalMessage.content, maxToolResultChars)
          : (finalMessage?.content ?? ""),
      messages: [...this.messages],
    };
  }

  async resolveCapabilities(): Promise<CapabilityMatrix> {
    try {
      return await this.capabilityRegistry.lookupModel(
        this.config.model,
        this.config.provider,
        "vercel-ai",
        this.config,
      );
    } catch (error) {
      this.logger.warn("Capability lookup failed; using conservative defaults", {
        providerId: this.config.provider ?? "default",
        modelId: this.config.model,
        ...describeError(error),
      });
      return {
        chat: false,
        tools: false,
        vision: false,
        streaming: false,
        structuredOutputs: false,
        promptCaching: false,
        reasoning: false,
        maxTokens: 0,
      };
    }
  }

  private budgetExceeded(summary: string): AgentResult {
    return {
      status: "budgetExceeded",
      summary,
      messages: [...this.messages],
    };
  }
}

function addStreamDeltaBytes(totalBytes: number, delta: string): number {
  const deltaBytes = new TextEncoder().encode(delta).byteLength;
  if (deltaBytes > MAX_STREAM_DELTA_BYTES) {
    throw new Error(`Provider stream delta byte limit exceeded (${MAX_STREAM_DELTA_BYTES} bytes)`);
  }
  const nextTotal = totalBytes + deltaBytes;
  if (nextTotal > MAX_STREAM_TOTAL_DELTA_BYTES) {
    throw new Error(
      `Provider stream total delta byte limit exceeded (${MAX_STREAM_TOTAL_DELTA_BYTES} bytes)`,
    );
  }
  return nextTotal;
}

function ensureBoundedStreamField(value: string, maxBytes: number, label: string): void {
  const encodedBytes = new TextEncoder().encode(value).byteLength;
  if (value.length > maxBytes || encodedBytes > maxBytes) {
    throw new Error(`Provider streamed ${label} limit exceeded (${maxBytes} bytes)`);
  }
}

function nextStreamChunk<T>(
  iterator: AsyncIterator<T>,
  signal: AbortSignal,
): Promise<IteratorResult<T>> {
  if (signal.aborted) return Promise.reject(new AgentCancelledError());
  return new Promise<IteratorResult<T>>((resolve, reject) => {
    let settled = false;
    const finish = (operation: () => void) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      operation();
    };
    const abort = () => finish(() => reject(new AgentCancelledError()));
    signal.addEventListener("abort", abort, { once: true });
    Promise.resolve(iterator.next()).then(
      (result) => finish(() => resolve(result)),
      (error: unknown) => finish(() => reject(error)),
    );
  });
}

async function closeStreamIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (!iterator.return) return;

  let cleanup: Promise<IteratorResult<T>>;
  try {
    cleanup = Promise.resolve(iterator.return());
  } catch {
    return;
  }

  // Attach both handlers immediately. If cleanup remains queued behind an
  // uncooperative `next()`, a later rejection is still observed and cannot
  // become an unhandled rejection after the bounded wait has elapsed.
  const handledCleanup = cleanup.then(
    () => undefined,
    () => undefined,
  );
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const cleanupDeadline = new Promise<void>((resolve) => {
    timeout = setTimeout(resolve, STREAM_ITERATOR_CLEANUP_TIMEOUT_MS);
  });
  await Promise.race([handledCleanup, cleanupDeadline]);
  if (timeout !== undefined) clearTimeout(timeout);
}

function waitForAbort<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new AgentCancelledError());
  return new Promise<T>((resolve, reject) => {
    const abort = () => reject(new AgentCancelledError());
    signal.addEventListener("abort", abort, { once: true });
    operation.then(
      (value) => {
        signal.removeEventListener("abort", abort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", abort);
        reject(error);
      },
    );
  });
}

function boundToolResult(result: string, limit: number): string {
  if (result.length <= limit) return result;
  const marker = `\n[truncated: tool result exceeded ${limit} characters]`;
  return `${result.slice(0, Math.max(0, limit - marker.length))}${marker}`;
}

function projectToolResultsForModel(messages: Message[], limit: number): Message[] {
  return messages.map((message) =>
    message.role === "tool"
      ? { ...message, content: boundToolResult(message.content, limit) }
      : message,
  );
}

function stripToolCalls(
  message: Extract<Message, { role: "assistant" }>,
): Extract<Message, { role: "assistant" }> {
  return {
    role: "assistant",
    content: message.content,
    ...(message.reasoning === undefined ? {} : { reasoning: message.reasoning }),
    ...(message.meta === undefined ? {} : { meta: message.meta }),
    ...(message.createdAt === undefined ? {} : { createdAt: message.createdAt }),
  };
}

function tokenCharge(response: LLMResponse, messages: Message[], instructions: string): number {
  const reported =
    response.usage?.totalTokens ??
    (response.usage?.inputTokens ?? 0) + (response.usage?.outputTokens ?? 0);
  if (reported > 0) return reported;

  let characters = instructions.length;
  for (const message of messages) {
    characters += message.content.length + (message.reasoning?.length ?? 0);
    for (const toolCall of message.toolCalls ?? []) {
      characters += toolCall.toolName.length + serializedLength(toolCall.args);
    }
  }
  return Math.max(1, Math.ceil(characters / 4));
}

function serializedLength(value: unknown): number {
  try {
    return JSON.stringify(value)?.length ?? 0;
  } catch {
    return 0;
  }
}
