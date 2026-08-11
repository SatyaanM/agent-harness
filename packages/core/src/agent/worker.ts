import type { CapabilityRegistry } from "../capability/registry.js";
import type { MessageBus } from "../collaboration/message-bus.js";
import type { LLMClient } from "../llm/client.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { ToolRegistry } from "../tool/types.js";
import type { AgentEventCallback } from "./agent.js";
import { Agent } from "./agent.js";
import type { AgentConfig, Message, TaskId } from "./types.js";
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

  constructor(
    public readonly taskId: TaskId,
    config: AgentConfig,
    toolRegistry: ToolRegistry,
    llmClient: LLMClient,
    capabilityRegistry: CapabilityRegistry,
    private readonly orchestratorId: TaskId,
    private readonly bus: MessageBus,
    private readonly abortSignal?: AbortSignal,
    onEvent?: AgentEventCallback,
    private readonly executionLimiter?: ExecutionLimiter,
  ) {
    this.agent = new Agent(config, toolRegistry, llmClient, capabilityRegistry, onEvent);
  }

  async run(task: string): Promise<WorkerResult> {
    try {
      const execute = () => this.agent.run(task, [], this.abortSignal);
      const result = this.executionLimiter
        ? await this.executionLimiter.run(execute)
        : await execute();
      this.messages = result.messages;

      const workerResult: WorkerResult = {
        taskId: this.taskId,
        status: result.status === "success" ? "done" : "error",
        summary: result.summary,
        messages: this.messages,
      };

      this.bus.message(this.orchestratorId, workerResult, this.taskId);
      return workerResult;
    } catch (error) {
      const workerResult: WorkerResult = {
        taskId: this.taskId,
        status: error instanceof AgentCancelledError ? "cancelled" : "error",
        summary:
          error instanceof AgentCancelledError
            ? "Cancelled by user"
            : error instanceof Error
              ? error.message
              : String(error),
        messages: this.messages,
      };

      this.bus.message(this.orchestratorId, workerResult, this.taskId);
      return workerResult;
    }
  }
}
