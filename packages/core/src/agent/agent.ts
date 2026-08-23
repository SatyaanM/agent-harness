import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import { getTracer, SpanKind, SpanStatusCode } from "../contracts/tracing.js";
import {
  type LLMClient,
  type LLMResponse,
  LLMResponseSchema,
  type LLMToolDefinition,
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

export type AgentEventCallback = (
  event:
    | { type: "tool:called"; toolName: string; args?: Record<string, unknown> }
    | { type: "tool:completed"; toolName: string; result?: string }
    | { type: "step"; messages: Message[] }
    | { type: "capability-mismatch"; detail: string },
) => void;

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

  async run(prompt?: string, history: Message[] = [], signal?: AbortSignal): Promise<AgentResult> {
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
        return await this.runWithSignal(prompt, history, runSignal);
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
  ): Promise<AgentResult> {
    const tracer = getTracer();
    this.messages = [...history];
    if (prompt) {
      this.messages.push({ role: "user", content: prompt });
    }

    const modelParts = this.config.model.split("/");
    const providerId = modelParts.length > 1 ? modelParts[0] || "default" : "default";
    const modelId = modelParts.length > 1 ? modelParts.slice(1).join("/") : this.config.model;

    let matrix: CapabilityMatrix;
    try {
      matrix = await this.capabilityRegistry.lookup(providerId, modelId, "vercel-ai", this.config);
    } catch {
      matrix = {
        chat: true,
        tools: true,
        vision: true,
        streaming: false,
        structuredOutputs: false,
        promptCaching: false,
        reasoning: false,
        maxTokens: 0,
      };
    }

    const tools = this.config.tools
      .map((name) => this.toolRegistry.get(name))
      .filter((t): t is NonNullable<typeof t> => t != null);

    const llmTools: LLMToolDefinition[] | undefined =
      matrix.tools && tools.length
        ? tools
            .filter((t) => !t.requiresHITL || matrix.reasoning)
            .map((t) => ({
              name: t.name,
              description: t.description,
              parameters: t.parameters,
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
            const rawResponse = await tracer.withSpan(llmSpan, async () => {
              return await this.llmClient.chat({
                messages: finalMessages,
                system: finalSystem,
                model: this.config.model,
                ...(this.config.provider ? { preferredProviderId: this.config.provider } : {}),
                ...(llmTools ? { tools: llmTools } : {}),
                maxOutputTokens,
                promptCaching: matrix.promptCaching,
                signal,
              });
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

          let responseToolCalls = response.toolCalls ?? response.message.toolCalls ?? [];

          // Emit diagnostic and discard hallucinated tool calls when tools are disabled
          if (!matrix.tools && responseToolCalls.length > 0) {
            this.onEvent?.({
              type: "capability-mismatch",
              detail: `Model returned ${responseToolCalls.length} tool call(s) but tools capability is disabled`,
            });
            responseToolCalls = [];
          }

          const responseMessage = responseToolCalls.length
            ? { ...response.message, toolCalls: responseToolCalls }
            : response.message;
          this.messages.push(responseMessage);
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

              const tool = this.toolRegistry.get(toolCall.toolName);

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

  private budgetExceeded(summary: string): AgentResult {
    return {
      status: "budgetExceeded",
      summary,
      messages: [...this.messages],
    };
  }
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
