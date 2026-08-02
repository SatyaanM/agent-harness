import { v4 as uuidv4 } from "uuid";
import type { AgentConfig, AgentResult } from "./types.js";
import { Agent } from "./agent.js";
import type { ToolRegistry } from "../tool/types.js";
import type { LLMClient } from "../llm/client.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import { SessionStore } from "../persistence/session.js";
import type { SessionData } from "../persistence/session.js";

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
  onEvent?: (event: SessionRuntimeEvent) => void;
}

export class SessionRuntime {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly sessionStore: SessionStore;

  constructor(private readonly options: SessionRuntimeOptions) {
    this.sessionStore = new SessionStore(options.sessionsDir);
  }

  /** Serialized delivery: only one run happens at a time per session. */
  deliver(message?: string, agentName?: string): Promise<AgentResult> {
    const run = this.queue.then(() => this.runOnce(message, agentName));
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(event: SessionRuntimeEventWithoutSession): void {
    this.options.onEvent?.({ sessionId: this.options.sessionId, ...event });
  }

  private async runOnce(message?: string, agentName?: string): Promise<AgentResult> {
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

    if (message) {
      session.messages.push({ role: "user", content: message, createdAt: now });
    }

    const latest = await this.sessionStore.load(this.options.sessionId);
    if (latest?.mailbox) session.mailbox = latest.mailbox;

    const delivered = session.mailbox ?? [];
    if (delivered.length > 0) {
      session.mailbox = [];
      session.messages.push(
        ...delivered.map((p) => ({
          role: "system" as const,
          content:
            `Worker "${p.agentName}" (task ${p.taskId}) ` +
            `${p.status === "done" ? "completed with the result below" : "failed with the error below"}. ` +
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
        }))
      );
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
      (e) =>
        this.emit({
          type: "agent:tool",
          agentName: agentConfig.name,
          tool: {
            type: e.type === "tool:called" ? "called" : "completed",
            toolName: e.toolName,
            args: e.args,
            result: e.result,
          },
        }),
    );

    this.emit({ type: "agent:started", agentName: agentConfig.name });

    let result: AgentResult;
    try {
      result = await agent.run(message, session.messages.slice(0, -1));
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.emit({ type: "agent:error", agentName: agentConfig.name, error: errorMessage });
      throw error;
    }

    session.messages.push({
      role: "assistant",
      content: result.summary,
      createdAt: now,
    });
    session.result = { status: result.status, summary: result.summary };
    session.completedAt = now;

    const onDisk = await this.sessionStore.load(this.options.sessionId);
    if (onDisk?.mailbox) session.mailbox = onDisk.mailbox;
    await this.sessionStore.save(session);

    this.emit({ type: "agent:completed", agentName: agentConfig.name, status: result.status });
    this.emit({ type: "session:updated", session });

    return result;
  }
}
