import { v4 as uuidv4 } from "uuid";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { LLMClient } from "../llm/client.js";
import type { SessionData } from "../persistence/session.js";
import { SessionStore } from "../persistence/session.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { ToolRegistry } from "../tool/types.js";
import { Agent } from "./agent.js";
import type { AgentConfig, AgentResult } from "./types.js";

export type SessionRuntimeEvent =
  | { sessionId: string; type: "agent:started"; agentName: string }
  | { sessionId: string; type: "agent:completed"; agentName: string; status: string }
  | { sessionId: string; type: "agent:error"; agentName?: string; error: string }
  | {
      sessionId: string;
      type: "agent:tool";
      agentName: string;
      tool: { type: "called" | "completed"; toolName: string; args?: unknown; result?: string };
    }
  | { sessionId: string; type: "session:updated"; session: SessionData };

export type SessionRuntimeEventWithoutSession =
  | { type: "agent:started"; agentName: string }
  | { type: "agent:completed"; agentName: string; status: string }
  | { type: "agent:error"; agentName?: string; error: string }
  | {
      type: "agent:tool";
      agentName: string;
      tool: { type: "called" | "completed"; toolName: string; args?: unknown; result?: string };
    }
  | { type: "session:updated"; session: SessionData };

export interface SessionRuntimeOptions {
  sessionId: string;
  sessionsDir: string;
  resolveConfig: (agentName: string | undefined) => AgentConfig;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  capabilityRegistry: CapabilityRegistry;
  executionLimiter?: ExecutionLimiter;
  onEvent?: (event: SessionRuntimeEvent) => void;
}

export class SessionRuntime {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessionStore: SessionStore;

  constructor(private readonly options: SessionRuntimeOptions) {
    this.sessionStore = new SessionStore(options.sessionsDir);
  }

  /** Serialized delivery: only one run happens at a time per session. */
  deliver(message?: string, agentName?: string, signal?: AbortSignal): Promise<AgentResult> {
    const run = this.queue.then(() => this.runOnce(message, agentName, signal));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(event: SessionRuntimeEventWithoutSession): void {
    this.options.onEvent?.({ sessionId: this.options.sessionId, ...event });
  }

  private async runOnce(
    message?: string,
    agentName?: string,
    signal?: AbortSignal,
  ): Promise<AgentResult> {
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

    // History handed to the agent = the loaded transcript + the delivered
    // mailbox completions. The new user prompt is NOT included: agent.run
    // re-adds it as the prompt itself, so it must be the last thing the model
    // sees.
    const baseHistory = [...session.messages];

    if (message) {
      session.messages.push({ role: "user", content: message, createdAt: now });
    }

    // Atomically drain the durable mailbox — the entire batch is delivered
    // together (ADR §10.9). Messages are removed from the log only on delivery.
    const delivered = await this.sessionStore.drainMailbox(this.options.sessionId);
    session.mailbox = [];
    const deliveredSystem = delivered.map((p) => ({
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
    if (delivered.length > 0) {
      session.messages.push(...deliveredSystem);
    }
    await this.sessionStore.save(session);

    if (!message && delivered.length === 0) {
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
    const agent = new Agent(
      runConfig,
      this.options.toolRegistry,
      this.options.llmClient,
      this.options.capabilityRegistry,
      (e) => {
        if (e.type === "step") {
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
        });
      },
    );

    let result: AgentResult;
    try {
      const execute = () => {
        this.emit({ type: "agent:started", agentName: agentConfig.name });
        return agent.run(message, [...baseHistory, ...deliveredSystem], signal);
      };
      result = this.options.executionLimiter
        ? await this.options.executionLimiter.run(execute, signal)
        : await execute();
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit({ type: "agent:error", agentName: agentConfig.name, error: errorMessage });
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

    await this.sessionStore.save(session);

    this.emit({ type: "agent:completed", agentName: agentConfig.name, status: result.status });
    this.emit({ type: "session:updated", session });

    return result;
  }
}
