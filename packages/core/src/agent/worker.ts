import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import {
  getTracer,
  type ISpan,
  SpanKind,
  SpanStatusCode,
  W3CTraceContext,
} from "../contracts/tracing.js";
import type { LLMClient } from "../llm/client.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { ToolRegistry } from "../tool/types.js";
import { Agent, type AgentEventCallback } from "./agent.js";

import type { AgentConfig, AgentResult, Message, TaskId } from "./types.js";
import { AgentCancelledError } from "./types.js";

export interface WorkerResult {
  taskId: TaskId;
  status: "done" | "error" | "cancelled";
  summary: string;
  messages: Message[];
}

export class Worker {
  private agent: Agent;
  private messages: Message[] = [];
  private readonly logger: Logger;

  constructor(
    public readonly taskId: TaskId,
    config: AgentConfig,
    toolRegistry: ToolRegistry,
    llmClient: LLMClient,
    capabilityRegistry: CapabilityRegistry,
    private readonly abortSignal?: AbortSignal,
    onEvent?: AgentEventCallback,
    private readonly executionLimiter?: ExecutionLimiter,
    logger?: Logger,
  ) {
    this.logger = (logger ?? createLogger("core.worker")).child({ taskId: this.taskId });
    this.agent = new Agent(
      config,
      toolRegistry,
      llmClient,
      capabilityRegistry,
      (event) => {
        if (event.type === "step") this.messages = event.messages;
        onEvent?.(event);
      },
      this.logger,
    );
  }

  async run(task: string, traceCarrier?: Record<string, unknown>): Promise<WorkerResult> {
    const tracer = getTracer();
    const parentContext = traceCarrier ? W3CTraceContext.extract(traceCarrier) : undefined;
    const span = tracer.startSpan(
      "worker.run",
      {
        kind: SpanKind.INTERNAL,
        links: parentContext ? [{ context: parentContext }] : undefined,
        attributes: {
          "agent.task_id": this.taskId,
          "agent.worker_session_id": `worker-${this.taskId}`,
        },
      },
      parentContext,
    );

    return tracer.withSpan(span, () => this.runInSpan(task, span));
  }

  private async runInSpan(task: string, span: ISpan): Promise<WorkerResult> {
    try {
      const result = await this.execute(task);
      this.messages = result.messages;
      const workerResult = this.toWorkerResult(result);
      span.setStatus({
        code: result.status === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      });
      return workerResult;
    } catch (error) {
      return this.handleFailure(error, span);
    } finally {
      span.end();
    }
  }

  private execute(task: string): Promise<AgentResult> {
    const execute = () => this.agent.run(task, [], this.abortSignal);
    return this.executionLimiter ? this.executionLimiter.run(execute, this.abortSignal) : execute();
  }

  private toWorkerResult(result: AgentResult): WorkerResult {
    return {
      taskId: this.taskId,
      status: result.status === "success" ? "done" : "error",
      summary: result.summary,
      messages: this.messages,
    };
  }

  private handleFailure(error: unknown, span: ISpan): WorkerResult {
    const isCancelled = isWorkerCancellation(error, this.abortSignal);
    const errorDetails = describeError(error);
    this.logger.error("Worker run failed", {
      code: errorDetails.code,
      cancelled: isCancelled,
    });
    span.recordException(error);
    span.setStatus({
      code: isCancelled ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: isCancelled ? "Cancelled by user" : errorDetails.message,
    });
    return {
      taskId: this.taskId,
      status: isCancelled ? "cancelled" : "error",
      summary: workerErrorSummary(error, isCancelled),
      messages: this.messages,
    };
  }
}

function isWorkerCancellation(error: unknown, signal?: AbortSignal): boolean {
  return (
    error instanceof AgentCancelledError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    Boolean(signal?.aborted)
  );
}

function workerErrorSummary(error: unknown, cancelled: boolean): string {
  if (cancelled) return "Cancelled by user";
  return error instanceof Error ? error.message : String(error);
}
