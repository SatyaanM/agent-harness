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
import { getTracer, type ISpan, SpanKind, SpanStatusCode } from "../contracts/tracing.js";
import {
  type LLMChatParams,
  type LLMClient,
  type LLMFinishReason,
  type LLMResponse,
  LLMResponseSchema,
  type LLMStreamDelta,
  type LLMToolDefinition,
  type LLMUsage,
} from "../llm/client.js";

import type { Tool, ToolRegistry } from "../tool/types.js";
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

interface AgentBudgetState {
  toolCallsUsed: number;
  totalTokensUsed: number;
}

interface AgentStepOptions {
  stepSpan: ISpan;
  matrix: CapabilityMatrix;
  llmTools: LLMToolDefinition[] | undefined;
  eligibleToolMap: Map<string, Tool>;
  maxToolCalls: number;
  maxToolResultChars: number;
  maxOutputTokens: number;
  maxTotalTokens: number;
  signal: AbortSignal;
  budget: AgentBudgetState;
}

interface StreamAccumulator {
  text: string;
  reasoning: string;
  toolCalls: Map<string, { name: string; argsText: string }>;
  totalDeltaBytes: number;
  finishReason: LLMFinishReason | undefined;
  usage: LLMUsage | undefined;
  streamStartedAt: number;
  firstTokenAt: number | undefined;
  finishedAt: number | undefined;
  streamFailed: boolean;
  streamFailure: unknown;
}

type ProviderToolCall = NonNullable<LLMResponse["toolCalls"]>[number];

interface ToolSelection {
  responseToolCalls: ProviderToolCall[];
  toolDenial: string | undefined;
}

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
    const budget: AgentBudgetState = { toolCallsUsed: 0, totalTokensUsed: 0 };

    for (let step = 0; step < this.config.maxSteps; step++) {
      if (signal.aborted) throw new AgentCancelledError();

      const stepSpan = tracer.startSpan("agent.step", {
        attributes: {
          "agent.step_index": step,
          "agent.name": this.config.name,
        },
      });

      try {
        const stepResult = await tracer.withSpan(stepSpan, () =>
          this.runStep({
            stepSpan,
            matrix,
            llmTools,
            eligibleToolMap,
            maxToolCalls,
            maxToolResultChars,
            maxOutputTokens,
            maxTotalTokens,
            signal,
            budget,
          }),
        );

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

  private async runStep(options: AgentStepOptions): Promise<AgentResult | undefined> {
    const response = await this.requestResponse(options);
    if (options.signal.aborted) {
      throw new AgentCancelledError();
    }

    const selection = this.selectToolCalls(response, options);
    this.appendResponse(response, selection);
    options.budget.totalTokensUsed += tokenCharge(
      response,
      projectToolResultsForModel(this.messages, options.maxToolResultChars),
      this.config.instructions,
    );

    const budgetResult = this.checkTokenBudget(selection.responseToolCalls, options);
    if (budgetResult) return budgetResult;

    if (response.finishReason === "stop") {
      options.stepSpan.setStatus({ code: SpanStatusCode.OK });
      return {
        status: "success",
        summary: response.message.content,
        messages: [...this.messages],
      };
    }

    if (response.finishReason !== "tool-calls") {
      options.stepSpan.setStatus({ code: SpanStatusCode.ERROR });
      return {
        status: "error",
        summary: `Provider stopped with finish reason ${response.finishReason}.`,
        messages: [...this.messages],
      };
    }

    if (selection.responseToolCalls.length > 0) {
      return this.executeToolCalls(selection, options);
    }
    return undefined;
  }

  private async requestResponse(options: AgentStepOptions): Promise<LLMResponse> {
    const tracer = getTracer();
    const llmSpan = tracer.startSpan("gen_ai.chat", {
      kind: SpanKind.CLIENT,
      attributes: {
        "gen_ai.request.model": this.config.model,
        "gen_ai.request.max_tokens": options.maxOutputTokens,
      },
    });
    const finalSystem = buildAgentSystem(
      this.config.instructions,
      options.matrix,
      options.llmTools,
    );
    const finalMessages = buildAgentMessages(
      this.messages,
      options.maxToolResultChars,
      options.matrix.vision,
    );
    const chatParams: LLMChatParams = {
      messages: finalMessages,
      system: finalSystem,
      model: this.config.model,
      ...(this.config.provider ? { preferredProviderId: this.config.provider } : {}),
      ...(options.llmTools ? { tools: options.llmTools } : {}),
      maxOutputTokens: options.maxOutputTokens,
      promptCaching: options.matrix.promptCaching,
      signal: options.signal,
    };

    try {
      const rawResponse = await tracer.withSpan(llmSpan, () =>
        this.requestRawResponse(chatParams, options, llmSpan),
      );
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
      return parsed;
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
  }

  private requestRawResponse(
    params: LLMChatParams,
    options: AgentStepOptions,
    llmSpan: ISpan,
  ): Promise<LLMResponse> {
    if (options.matrix.streaming && this.llmClient.chatStream) {
      return this.streamResponse(params, options.maxToolCalls, options.signal, llmSpan);
    }
    return this.llmClient.chat(params);
  }

  private async streamResponse(
    params: LLMChatParams,
    maxToolCalls: number,
    signal: AbortSignal,
    llmSpan: ISpan,
  ): Promise<LLMResponse> {
    const chatStream = this.llmClient.chatStream;
    if (!chatStream) {
      return this.llmClient.chat(params);
    }

    const streamIterator = chatStream(params)[Symbol.asyncIterator]();
    const state = createStreamAccumulator();
    try {
      await this.consumeStream(streamIterator, state, maxToolCalls, signal);
    } catch (error) {
      state.streamFailed = true;
      state.streamFailure = error;
      state.finishedAt = Date.now();
    } finally {
      await closeStreamIterator(streamIterator);
    }

    const metrics = buildStreamMetrics(state);
    setStreamSpanAttributes(llmSpan, metrics);
    this.onEvent?.({ type: "stream-metrics", metrics });

    if (state.streamFailed) {
      throw state.streamFailure;
    }
    if (!state.finishReason) {
      throw new Error("Provider stream ended without a terminal finish event");
    }
    return buildStreamResponse(state, state.finishReason);
  }

  private async consumeStream(
    iterator: AsyncIterator<LLMStreamDelta>,
    state: StreamAccumulator,
    maxToolCalls: number,
    signal: AbortSignal,
  ): Promise<void> {
    while (true) {
      const next = await nextStreamChunk(iterator, signal);
      if (next.done) break;
      this.processStreamChunk(next.value, state, maxToolCalls);
    }
  }

  private processStreamChunk(
    chunk: LLMStreamDelta,
    state: StreamAccumulator,
    maxToolCalls: number,
  ): void {
    if (state.finishReason !== undefined) {
      throw new Error(`Provider stream emitted ${chunk.type} after terminal finish event`);
    }

    switch (chunk.type) {
      case "text-delta":
        this.appendTextDelta(state, chunk);
        return;
      case "reasoning-delta":
        this.appendReasoningDelta(state, chunk);
        return;
      case "tool-call-delta":
        this.appendToolCallDelta(state, chunk, maxToolCalls);
        return;
      case "finish":
        state.finishReason = chunk.finishReason;
        state.usage = chunk.usage;
        state.finishedAt = Date.now();
        return;
    }
  }

  private appendTextDelta(
    state: StreamAccumulator,
    chunk: Extract<LLMStreamDelta, { type: "text-delta" }>,
  ): void {
    state.totalDeltaBytes = addStreamDeltaBytes(state.totalDeltaBytes, chunk.text);
    if (state.text.length + chunk.text.length > MAX_STREAM_TEXT_CHARS) {
      throw new Error(
        `Provider streamed text limit exceeded (${MAX_STREAM_TEXT_CHARS} characters)`,
      );
    }
    state.firstTokenAt ??= Date.now();
    state.text += chunk.text;
    this.onEvent?.(chunk);
  }

  private appendReasoningDelta(
    state: StreamAccumulator,
    chunk: Extract<LLMStreamDelta, { type: "reasoning-delta" }>,
  ): void {
    state.totalDeltaBytes = addStreamDeltaBytes(state.totalDeltaBytes, chunk.reasoning);
    if (state.reasoning.length + chunk.reasoning.length > MAX_STREAM_REASONING_CHARS) {
      throw new Error(
        "Provider streamed reasoning limit exceeded (" +
          MAX_STREAM_REASONING_CHARS +
          " characters)",
      );
    }
    state.reasoning += chunk.reasoning;
  }

  private appendToolCallDelta(
    state: StreamAccumulator,
    chunk: Extract<LLMStreamDelta, { type: "tool-call-delta" }>,
    maxToolCalls: number,
  ): void {
    if (!chunk.toolCall) return;
    ensureBoundedStreamField(chunk.toolCall.id, MAX_STREAM_TOOL_CALL_ID_BYTES, "tool call id");
    ensureBoundedStreamField(chunk.toolCall.name, MAX_STREAM_TOOL_NAME_BYTES, "tool name");
    state.totalDeltaBytes = addStreamDeltaBytes(state.totalDeltaBytes, chunk.toolCall.id);
    state.totalDeltaBytes = addStreamDeltaBytes(state.totalDeltaBytes, chunk.toolCall.name);
    state.totalDeltaBytes = addStreamDeltaBytes(
      state.totalDeltaBytes,
      chunk.toolCall.argumentsDelta,
    );

    const existing = state.toolCalls.get(chunk.toolCall.id) ?? {
      name: chunk.toolCall.name,
      argsText: "",
    };
    if (!state.toolCalls.has(chunk.toolCall.id) && state.toolCalls.size >= maxToolCalls) {
      throw new Error(`Provider streamed tool-call count limit exceeded (${maxToolCalls})`);
    }
    if (
      existing.argsText.length + chunk.toolCall.argumentsDelta.length >
      MAX_STREAM_TOOL_ARGUMENT_CHARS
    ) {
      throw new Error(
        "Provider streamed tool argument limit exceeded (" +
          MAX_STREAM_TOOL_ARGUMENT_CHARS +
          " characters)",
      );
    }
    existing.argsText += chunk.toolCall.argumentsDelta;
    state.toolCalls.set(chunk.toolCall.id, existing);
    this.onEvent?.(chunk);
  }

  private selectToolCalls(response: LLMResponse, options: AgentStepOptions): ToolSelection {
    const providerToolCalls = response.toolCalls ?? response.message.toolCalls ?? [];
    const deniedToolCalls = providerToolCalls.filter(
      (toolCall) => !options.eligibleToolMap.has(toolCall.toolName),
    );
    const responseToolCalls = providerToolCalls.filter((toolCall) =>
      options.eligibleToolMap.has(toolCall.toolName),
    );
    if (deniedToolCalls.length === 0) {
      return { responseToolCalls, toolDenial: undefined };
    }

    const detail = !options.matrix.tools
      ? "Model returned " +
        deniedToolCalls.length +
        " tool call(s) but tools capability is disabled"
      : "Model returned tool call(s) outside the eligible tool map: " +
        deniedToolCalls.map((call) => call.toolName).join(", ");
    this.onEvent?.({ type: "capability-mismatch", detail });
    this.logger.warn("Capability mismatch", {
      capability: "tools",
      model: this.config.model,
      toolCallCount: deniedToolCalls.length,
      toolNames: deniedToolCalls.map((call) => call.toolName),
    });
    const toolDenial = options.matrix.tools
      ? "One or more requested tools are not eligible for this agent run. Do not call unavailable, unconfigured, delegated, or approval-required tools; continue using only the provided tools or answer with text."
      : "Tool calls are disabled for this model. Do not call tools; answer using text only.";
    return { responseToolCalls, toolDenial };
  }

  private appendResponse(response: LLMResponse, selection: ToolSelection): void {
    const responseMessage =
      selection.responseToolCalls.length > 0
        ? { ...response.message, toolCalls: selection.responseToolCalls }
        : stripToolCalls(response.message);
    this.messages.push(responseMessage);
    if (selection.toolDenial && selection.responseToolCalls.length === 0) {
      this.messages.push({ role: "system", content: selection.toolDenial });
    }
    this.onEvent?.({ type: "step", messages: [...this.messages] });
  }

  private checkTokenBudget(
    responseToolCalls: ProviderToolCall[],
    options: AgentStepOptions,
  ): AgentResult | undefined {
    if (options.budget.totalTokensUsed <= options.maxTotalTokens) return undefined;
    if (responseToolCalls.length > 0) {
      this.messages.push(
        ...responseToolCalls.map((toolCall) => ({
          role: "tool" as const,
          content:
            "Error: Agent token budget exceeded (" +
            options.budget.totalTokensUsed +
            "/" +
            options.maxTotalTokens +
            "); tool was not executed.",
          toolCallId: toolCall.toolCallId,
        })),
      );
    }
    options.stepSpan.setStatus({ code: SpanStatusCode.ERROR });
    return this.budgetExceeded(
      "Agent token budget exceeded (" +
        options.budget.totalTokensUsed +
        "/" +
        options.maxTotalTokens +
        ").",
    );
  }

  private async executeToolCalls(
    selection: ToolSelection,
    options: AgentStepOptions,
  ): Promise<AgentResult | undefined> {
    for (const [toolCallIndex, toolCall] of selection.responseToolCalls.entries()) {
      if (options.signal.aborted) {
        throw new AgentCancelledError();
      }
      if (options.budget.toolCallsUsed >= options.maxToolCalls) {
        this.messages.push(
          ...selection.responseToolCalls.slice(toolCallIndex).map((skipped) => ({
            role: "tool" as const,
            content: `Error: Agent tool-call budget exceeded (${options.maxToolCalls}).`,
            toolCallId: skipped.toolCallId,
          })),
        );
        options.stepSpan.setStatus({ code: SpanStatusCode.ERROR });
        return this.budgetExceeded(`Agent tool-call budget exceeded (${options.maxToolCalls}).`);
      }
      options.budget.toolCallsUsed += 1;

      const tool = options.eligibleToolMap.get(toolCall.toolName);
      if (!tool) {
        this.messages.push({
          role: "tool",
          content: `Error: Tool "${toolCall.toolName}" not found`,
          toolCallId: toolCall.toolCallId,
        });
        continue;
      }

      await this.executeToolCall(tool, toolCall, options);
    }
    if (selection.toolDenial) {
      this.messages.push({ role: "system", content: selection.toolDenial });
    }
    this.onEvent?.({ type: "step", messages: [...this.messages] });
    return undefined;
  }

  private async executeToolCall(
    tool: Tool,
    toolCall: ProviderToolCall,
    options: AgentStepOptions,
  ): Promise<void> {
    const tracer = getTracer();
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
      await tracer.withSpan(toolSpan, () =>
        this.runTool(tool, toolCall, options.signal, options.maxToolResultChars, toolSpan),
      );
    } catch (error) {
      this.recordToolFailure(error, toolCall, toolSpan, options.signal);
    } finally {
      toolSpan.end();
    }
  }

  private async runTool(
    tool: Tool,
    toolCall: ProviderToolCall,
    signal: AbortSignal,
    maxToolResultChars: number,
    toolSpan: ISpan,
  ): Promise<void> {
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
  }

  private recordToolFailure(
    error: unknown,
    toolCall: ProviderToolCall,
    toolSpan: ISpan,
    signal: AbortSignal,
  ): void {
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

function buildAgentSystem(
  instructions: string,
  matrix: CapabilityMatrix,
  llmTools: LLMToolDefinition[] | undefined,
): string {
  if (matrix.structuredOutputs || !llmTools || llmTools.length === 0) {
    return instructions;
  }
  return (
    instructions +
    "\n\nYou must strictly adhere to the provided JSON schemas for any tools you invoke."
  );
}

function buildAgentMessages(
  messages: Message[],
  maxToolResultChars: number,
  vision: boolean,
): Message[] {
  const projected = projectToolResultsForModel(messages, maxToolResultChars);
  if (vision) return projected;
  return projected.map((message) => ({
    ...message,
    content: message.content.replace(/!\[.*?\]\(.*?\)/g, "[Image omitted due to model capability]"),
  }));
}

function createStreamAccumulator(): StreamAccumulator {
  return {
    text: "",
    reasoning: "",
    toolCalls: new Map(),
    totalDeltaBytes: 0,
    finishReason: undefined,
    usage: undefined,
    streamStartedAt: Date.now(),
    firstTokenAt: undefined,
    finishedAt: undefined,
    streamFailed: false,
    streamFailure: undefined,
  };
}

function buildStreamMetrics(state: StreamAccumulator): StreamPerformanceMetrics {
  state.finishedAt ??= Date.now();
  const outputTokens = state.usage?.outputTokens ?? Math.ceil(state.text.length / 4);
  const durationMs = Math.max(0, state.finishedAt - state.streamStartedAt);
  const generationMs =
    state.firstTokenAt === undefined ? 0 : Math.max(0, state.finishedAt - state.firstTokenAt);
  return {
    ttftMs: state.firstTokenAt === undefined ? null : state.firstTokenAt - state.streamStartedAt,
    tokensPerSecond:
      state.firstTokenAt === undefined || outputTokens === 0
        ? null
        : outputTokens / Math.max(generationMs / 1_000, 0.001),
    outputTokens,
    durationMs,
  };
}

function setStreamSpanAttributes(span: ISpan, metrics: StreamPerformanceMetrics): void {
  span.setAttributes({
    ...(metrics.ttftMs === null
      ? {}
      : { "gen_ai.performance.time_to_first_token_ms": metrics.ttftMs }),
    ...(metrics.tokensPerSecond === null
      ? {}
      : { "gen_ai.performance.output_tokens_per_second": metrics.tokensPerSecond }),
  });
}

function buildStreamResponse(state: StreamAccumulator, finishReason: LLMFinishReason): LLMResponse {
  const toolCalls = parseStreamToolCalls(state.toolCalls);
  return {
    message: {
      role: "assistant",
      content: state.text,
      ...(state.reasoning ? { reasoning: state.reasoning } : {}),
      ...(toolCalls.length > 0 ? { toolCalls } : {}),
    },
    finishReason,
    ...(toolCalls.length > 0 ? { toolCalls } : {}),
    ...(state.usage ? { usage: state.usage } : {}),
  };
}

function parseStreamToolCalls(
  toolCallsMap: Map<string, { name: string; argsText: string }>,
): NonNullable<LLMResponse["toolCalls"]> {
  return Array.from(toolCallsMap.entries()).map(([id, toolCall]) => {
    try {
      return { toolCallId: id, toolName: toolCall.name, args: JSON.parse(toolCall.argsText) };
    } catch (error) {
      throw new Error(
        "Failed to parse tool call arguments for " +
          toolCall.name +
          " (" +
          id +
          "): " +
          (error instanceof Error ? error.message : String(error)),
        { cause: error },
      );
    }
  });
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
