import { v4 as uuidv4 } from "uuid";
import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import type { LLMClient } from "../llm/client.js";
import type { SessionData } from "../persistence/session.js";
import { SessionStore } from "../persistence/session.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { ToolRegistry } from "../tool/types.js";
import { isRecord } from "../validation.js";
import { Agent } from "./agent.js";
import {
  AgentBudgetExceededError,
  AgentCancelledError,
  type AgentConfig,
  type AgentResult,
  type Message,
} from "./types.js";

export type SessionRuntimeEvent =
  | {
      sessionId: string;
      type: "agent:started";
      agentName: string;
      runId: string;
      requestId?: string;
    }
  | {
      sessionId: string;
      type: "agent:completed";
      agentName: string;
      status: string;
      runId: string;
      requestId?: string;
    }
  | {
      sessionId: string;
      type: "agent:error";
      agentName?: string;
      error: string;
      code?: string;
      runId: string;
      requestId?: string;
    }
  | {
      sessionId: string;
      type: "agent:tool";
      agentName: string;
      tool: { type: "called" | "completed"; toolName: string; args?: unknown; result?: string };
      runId: string;
      requestId?: string;
    }
  | { sessionId: string; type: "session:updated"; session: SessionData };

export type SessionRuntimeEventWithoutSession =
  | {
      type: "agent:started";
      agentName: string;
      runId: string;
      requestId?: string;
    }
  | {
      type: "agent:completed";
      agentName: string;
      status: string;
      runId: string;
      requestId?: string;
    }
  | {
      type: "agent:error";
      agentName?: string;
      error: string;
      code?: string;
      runId: string;
      requestId?: string;
    }
  | {
      type: "agent:tool";
      agentName: string;
      tool: { type: "called" | "completed"; toolName: string; args?: unknown; result?: string };
      runId: string;
      requestId?: string;
    }
  | { type: "session:updated"; session: SessionData };

export interface RunCorrelation {
  runId: string;
  requestId?: string;
}

export interface SessionRuntimeOptions {
  sessionId: string;
  sessionsDir: string;
  resolveConfig: (agentName: string | undefined) => AgentConfig;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  capabilityRegistry: CapabilityRegistry;
  executionLimiter?: ExecutionLimiter;
  onEvent?: (event: SessionRuntimeEvent) => void;
  isSessionAvailable?: (sessionId: string) => boolean;
}

export class SessionRuntime {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessionStore: SessionStore;
  private readonly logger: Logger;

  constructor(private readonly options: SessionRuntimeOptions) {
    this.sessionStore = new SessionStore(options.sessionsDir);
    this.logger = createLogger("core.session-runtime").child({ sessionId: options.sessionId });
  }

  /** Serialized delivery: only one run happens at a time per session. */
  deliver(
    message?: string,
    agentName?: string,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<AgentResult> {
    const run = this.queue.then(() => this.runOnce(message, agentName, signal, false, requestId));
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Replay a user delivery already present in the durable transcript. */
  retry(
    message: string,
    agentName?: string,
    signal?: AbortSignal,
    requestId?: string,
  ): Promise<AgentResult> {
    const run = this.queue.then(() => this.runOnce(message, agentName, signal, true, requestId));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(event: SessionRuntimeEventWithoutSession): void {
    this.options.onEvent?.({ sessionId: this.options.sessionId, ...event });
  }

  private isAvailable(): boolean {
    return (
      !this.options.isSessionAvailable || this.options.isSessionAvailable(this.options.sessionId)
    );
  }

  private async runOnce(
    message?: string,
    agentName?: string,
    signal?: AbortSignal,
    replayExistingUser = false,
    requestId?: string,
  ): Promise<AgentResult> {
    if (!this.isAvailable()) {
      return {
        status: "cancelled",
        summary: "Session is no longer available",
        messages: [],
      };
    }

    // A fresh run identity per execution attempt. It is ephemeral correlation
    // context for logs and WebSocket events, not a durable transcript field.
    const runId = uuidv4();
    const correlation: RunCorrelation = { runId, requestId };
    const logger = this.logger.child({ runId, ...(requestId ? { requestId } : {}) });

    const now = new Date().toISOString();

    let session = await this.sessionStore.load(this.options.sessionId);
    if (!session) {
      session = {
        sessionId: this.options.sessionId,
        taskId: uuidv4(),
        prompt: message ?? "",
        agentName: agentName ?? "orchestrator",
        messages: [],
        mailbox: [],
        createdAt: now,
      };
    }
    if (agentName) session.agentName = agentName;
    if (message) session.prompt = message;

    const persistedHistory = [...session.messages];
    let replayedUserIndex = -1;
    if (replayExistingUser) {
      for (let index = persistedHistory.length - 1; index >= 0; index -= 1) {
        const candidate = persistedHistory[index];
        if (candidate?.role === "user" && candidate.content === message) {
          replayedUserIndex = index;
          break;
        }
      }
      if (replayedUserIndex === -1) {
        throw new Error("Cannot retry a message that is not present in the session transcript");
      }
    }

    // History handed to the agent = the loaded transcript + the delivered
    // mailbox completions. The new user prompt is NOT included: agent.run
    // re-adds it as the prompt itself, so it must be the last thing the model
    // sees. A retry removes the already-durable copy only from model context;
    // the persisted transcript keeps that single audit record.
    const baseHistory =
      replayedUserIndex === -1
        ? persistedHistory
        : [
            ...persistedHistory.slice(0, replayedUserIndex),
            ...persistedHistory.slice(replayedUserIndex + 1),
          ];

    // Materialize before acknowledgement. If the process fails after the
    // transcript save but before acknowledgement, taskId makes recovery
    // idempotent and prevents duplicate system messages.
    const pending = await this.sessionStore.peekMailbox(this.options.sessionId);
    const materializedTaskIds = new Set(
      baseHistory.flatMap((existing) => {
        if (!isRecord(existing.meta) || existing.meta.kind !== "worker_completed") return [];
        return typeof existing.meta.taskId === "string" ? [existing.meta.taskId] : [];
      }),
    );
    const delivered = pending.filter((entry) => !materializedTaskIds.has(entry.taskId));
    const deliveredSystem: Message[] = delivered.map((p) => ({
      role: "system" as const,
      content:
        `Worker "${p.agentName}" (task ${p.taskId}) ` +
        `${
          p.status === "done"
            ? "completed with the result below"
            : p.status === "cancelled"
              ? "was cancelled by the user"
              : "failed with the error below"
        }. ` +
        `${p.summary}\n\n` +
        `This is the final result of the task you delegated. Present it to the user. Do not delegate this task again.`,
      createdAt: p.receivedAt,
      meta: {
        kind: "worker_completed",
        taskId: p.taskId,
        agentName: p.agentName,
        status: p.status,
        summary: p.summary,
      },
    }));
    session.messages = [
      ...persistedHistory,
      ...deliveredSystem,
      ...(message && !replayExistingUser
        ? [{ role: "user" as const, content: message, createdAt: now }]
        : []),
    ];
    session.mailbox = pending;

    if (!this.isAvailable()) {
      return {
        status: "cancelled",
        summary: "Session is no longer available",
        messages: [...session.messages],
      };
    }

    await this.sessionStore.save(session);
    if (pending.length > 0 && this.isAvailable()) {
      try {
        await this.sessionStore.acknowledgeMailbox(
          this.options.sessionId,
          pending.map((entry) => entry.taskId),
        );
        session.mailbox = [];
      } catch (ackError) {
        logger.warn("Failed to acknowledge mailbox", { ...describeError(ackError) });
      }
    }

    if (!message && deliveredSystem.length === 0) {
      return {
        status: "success",
        summary: "",
        messages: [...session.messages],
      };
    }

    const agentConfig = this.options.resolveConfig(session.agentName);
    // Wake runs (system-delivered completions, no user message) must report
    // results, not spawn new work: drop the delegate tool to prevent runaway
    // autonomous re-delegation.
    const runTools = message
      ? agentConfig.tools
      : agentConfig.tools.filter((t) => t !== "delegate");
    const runConfig = { ...agentConfig, tools: runTools };
    let latestRunMessages: Message[] | undefined;
    const agent = new Agent(
      runConfig,
      this.options.toolRegistry,
      this.options.llmClient,
      this.options.capabilityRegistry,
      (e) => {
        if (e.type === "step") {
          latestRunMessages = e.messages;
          // Live update: emit the session with the messages produced so far,
          // so the chat fills in as the agent works instead of all at once.
          const liveAppended = e.messages
            .slice(baseHistory.length + deliveredSystem.length + (message ? 1 : 0))
            .map((m) => ({ ...m, createdAt: m.createdAt ?? now }));
          this.emit({
            type: "session:updated",
            session: { ...session, messages: [...session.messages, ...liveAppended] },
          });
          return;
        }
        const isCalled = e.type === "tool:called";
        this.emit({
          type: "agent:tool",
          agentName: agentConfig.name,
          tool: {
            type: isCalled ? "called" : "completed",
            toolName: e.toolName,
            args: isCalled ? e.args : undefined,
            result: isCalled ? undefined : e.result,
          },
          ...correlation,
        });
      },
      logger,
    );

    let result: AgentResult;
    try {
      const execute = () => {
        this.emit({ type: "agent:started", agentName: agentConfig.name, ...correlation });
        return agent.run(message, [...baseHistory, ...deliveredSystem], signal);
      };
      result = this.options.executionLimiter
        ? await this.options.executionLimiter.run(execute, signal)
        : await execute();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      const errorCode = describeError(error).code;
      const isCancelled =
        error instanceof AgentCancelledError ||
        (error instanceof DOMException && error.name === "AbortError") ||
        Boolean(signal?.aborted);
      const isBudgetExceeded = error instanceof AgentBudgetExceededError;

      logger.error("Agent run failed", { code: errorCode, cancelled: isCancelled });

      const partial = (latestRunMessages ?? [])
        .slice(baseHistory.length + deliveredSystem.length + (message ? 1 : 0))
        .map((entry) => ({ ...entry, createdAt: entry.createdAt ?? new Date().toISOString() }));
      session.messages.push(...partial);
      session.result = {
        status: isCancelled ? "cancelled" : isBudgetExceeded ? "budgetExceeded" : "error",
        summary: errorMessage,
      };
      session.completedAt = new Date().toISOString();

      if (this.isAvailable()) {
        try {
          await this.sessionStore.save(session);
          this.emit({ type: "session:updated", session });
        } catch (persistenceError) {
          const persistenceMessage =
            persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
          this.emit({
            type: "agent:error",
            agentName: agentConfig.name,
            error: `Failed to persist partial run: ${persistenceMessage}`,
            code: describeError(persistenceError).code,
            ...correlation,
          });
        }
      }
      this.emit({
        type: "agent:error",
        agentName: agentConfig.name,
        error: errorMessage,
        code: errorCode,
        ...correlation,
      });
      throw error;
    }

    // Persist the full run record — every assistant message (with tool calls
    // and reasoning) and every tool result — so the transcript is a complete
    // audit of what the agent did. Slice off the history that was passed in
    // (baseHistory + deliveredSystem + the prompt agent.run re-added), keeping
    // only the messages this run actually produced.
    const appended = result.messages
      .slice(baseHistory.length + deliveredSystem.length + (message ? 1 : 0))
      .map((m) => ({ ...m, createdAt: m.createdAt ?? now }));
    session.messages.push(...appended);
    session.result = { status: result.status, summary: result.summary };
    session.completedAt = new Date().toISOString();

    if (this.isAvailable()) {
      await this.sessionStore.save(session);
      this.emit({
        type: "agent:completed",
        agentName: agentConfig.name,
        status: result.status,
        ...correlation,
      });
      this.emit({ type: "session:updated", session });
    }

    return result;
  }
}
