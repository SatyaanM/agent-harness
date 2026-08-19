import { v4 as uuidv4 } from "uuid";
import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import { type PendingMessage, PendingMessageSchema } from "../contracts/session.js";
import type { LLMClient } from "../llm/client.js";
import type { SessionData } from "../persistence/session.js";
import { SessionStore } from "../persistence/session.js";
import { MailboxRepository } from "../persistence/sqlite/mailbox-repo.js";
import { MessageRepository } from "../persistence/sqlite/message-repo.js";
import { RunRepository } from "../persistence/sqlite/run-repo.js";
import { SessionRepository } from "../persistence/sqlite/session-repo.js";
import type { ISqliteDatabase } from "../persistence/sqlite/types.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { ToolRegistry } from "../tool/types.js";
import { isRecord, parseJsonBoundary } from "../validation.js";
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
  sessionsDir?: string;
  db?: ISqliteDatabase;
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
  private readonly sessionStore?: SessionStore;
  private readonly db?: ISqliteDatabase;
  private readonly sessionRepo?: SessionRepository;
  private readonly messageRepo?: MessageRepository;
  private readonly runRepo?: RunRepository;
  private readonly mailboxRepo?: MailboxRepository;
  private readonly logger: Logger;

  constructor(private readonly options: SessionRuntimeOptions) {
    if (options.sessionsDir) {
      this.sessionStore = new SessionStore(options.sessionsDir);
    }
    if (options.db) {
      this.db = options.db;
      this.sessionRepo = new SessionRepository(options.db);
      this.messageRepo = new MessageRepository(options.db);
      this.runRepo = new RunRepository(options.db);
      this.mailboxRepo = new MailboxRepository(options.db);
    }
    this.logger = createLogger("core.session-runtime").child({ sessionId: options.sessionId });
  }

  /**
   * Serialized delivery: only one run happens at a time per session.
   *
   * IMPORTANT: `onEvent` callbacks MUST NOT synchronously `await` `deliver()`
   * from the same runtime. Re-entrancy through the same promise chain is
   * safe in principle (no stack overflow — `Promise.then` is async), but the
   * awaited run will queue behind the currently-executing callback and the
   * caller will hang. If you need to trigger a follow-up run from an event
   * callback, fire it without awaiting or schedule it on `queueMicrotask`.
   */
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

    let session: SessionData | null = null;
    if (this.sessionStore) {
      session = await this.sessionStore.load(this.options.sessionId);
    }

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

    // Transactional Mailbox Drain Protocol
    let pending: PendingMessage[] = [];
    if (this.db && this.mailboxRepo && this.sessionRepo && this.messageRepo && this.runRepo) {
      const db = this.db;
      const mailboxRepo = this.mailboxRepo;
      const sessionRepo = this.sessionRepo;
      const messageRepo = this.messageRepo;
      const runRepo = this.runRepo;

      db.immediateTransaction(() => {
        // 1. Ensure session row exists in SQLite
        const existingSession = sessionRepo.get(this.options.sessionId);
        if (!existingSession) {
          sessionRepo.create({
            id: this.options.sessionId,
            agentName: session?.agentName ?? "orchestrator",
            prompt: message ?? "",
            createdAt: Date.now(),
          });
        }

        // 2. Peek pending mailbox events from SQLite
        const pendingEvents = mailboxRepo.peekPending(this.options.sessionId);
        const parsedPendingEvents: { evt: (typeof pendingEvents)[0]; parsed: PendingMessage }[] =
          [];
        for (const evt of pendingEvents) {
          const parsed = parseJsonBoundary(
            PendingMessageSchema,
            evt.payload,
            `mailbox_event ${evt.id}`,
          );
          parsedPendingEvents.push({ evt, parsed });
        }
        pending = parsedPendingEvents.map((p) => p.parsed);

        // 3. Materialize system messages and acknowledge mailbox events atomically
        const existingTaskIds = new Set(
          baseHistory.flatMap((existing) => {
            if (!isRecord(existing.meta) || existing.meta.kind !== "worker_completed") return [];
            return typeof existing.meta.taskId === "string" ? [existing.meta.taskId] : [];
          }),
        );

        for (const { evt, parsed } of parsedPendingEvents) {
          if (!existingTaskIds.has(parsed.taskId)) {
            const nextSeq = messageRepo.getNextSequenceNum(this.options.sessionId);
            messageRepo.create({
              sessionId: this.options.sessionId,
              role: "system",
              content:
                `Worker "${parsed.agentName}" (task ${parsed.taskId}) ` +
                `${
                  parsed.status === "done"
                    ? "completed with the result below"
                    : parsed.status === "cancelled"
                      ? "was cancelled by the user"
                      : "failed with the error below"
                }. ` +
                `${parsed.summary}\n\n` +
                `This is the final result of the task you delegated. Present it to the user. Do not delegate this task again.`,
              sequenceNum: nextSeq,
              createdAt: Date.now(),
              metadata: {
                meta: {
                  kind: "worker_completed",
                  taskId: parsed.taskId,
                  agentName: parsed.agentName,
                  status: parsed.status,
                  summary: parsed.summary,
                },
              },
            });
            existingTaskIds.add(parsed.taskId);
          }
          mailboxRepo.acknowledge(evt.id);
        }

        // 4. Insert user message into SQLite messages table if present and not replayed
        if (message && !replayExistingUser) {
          const nextSeq = messageRepo.getNextSequenceNum(this.options.sessionId);
          messageRepo.create({
            sessionId: this.options.sessionId,
            role: "user",
            content: message,
            sequenceNum: nextSeq,
            createdAt: Date.now(),
          });
        }

        // 5. Create run record in SQLite
        runRepo.create({
          runId,
          sessionId: this.options.sessionId,
          requestId: requestId ?? null,
          status: "running",
          startedAt: Date.now(),
        });

        // 6. Update sessions.updated_at
        sessionRepo.update(this.options.sessionId, {
          updatedAt: Date.now(),
          prompt: message ?? undefined,
        });
      })();
    } else if (this.sessionStore) {
      pending = (await this.sessionStore.peekMailbox(this.options.sessionId)) ?? [];
    }

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

    if (this.sessionStore) {
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
        if (this.db && this.runRepo && this.sessionRepo && this.messageRepo) {
          const runRepo = this.runRepo;
          const sessionRepo = this.sessionRepo;
          const messageRepo = this.messageRepo;
          this.db.immediateTransaction(() => {
            for (const msg of partial) {
              const nextSeq = messageRepo.getNextSequenceNum(this.options.sessionId);
              messageRepo.create({
                sessionId: this.options.sessionId,
                runId,
                role: msg.role,
                content: msg.content,
                reasoning: msg.role === "assistant" ? (msg.reasoning ?? null) : null,
                toolCalls: msg.role === "assistant" ? (msg.toolCalls ?? null) : null,
                toolCallId: msg.role === "tool" ? (msg.toolCallId ?? null) : null,
                sequenceNum: nextSeq,
                createdAt: Date.now(),
              });
            }
            runRepo.update(runId, {
              status: isCancelled ? "cancelled" : "failed",
              errorCode,
              errorMessage,
              completedAt: Date.now(),
            });
            sessionRepo.update(this.options.sessionId, {
              completedAt: Date.now(),
              updatedAt: Date.now(),
            });
          })();
        }

        if (this.sessionStore) {
          try {
            await this.sessionStore.save(session);
            this.emit({ type: "session:updated", session });
          } catch (persistenceError) {
            const persistenceMessage =
              persistenceError instanceof Error
                ? persistenceError.message
                : String(persistenceError);
            this.emit({
              type: "agent:error",
              agentName: agentConfig.name,
              error: `Failed to persist partial run: ${persistenceMessage}`,
              code: describeError(persistenceError).code,
              ...correlation,
            });
          }
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
      if (this.db && this.runRepo && this.sessionRepo && this.messageRepo) {
        const runRepo = this.runRepo;
        const sessionRepo = this.sessionRepo;
        const messageRepo = this.messageRepo;
        this.db.immediateTransaction(() => {
          for (const msg of appended) {
            const nextSeq = messageRepo.getNextSequenceNum(this.options.sessionId);
            messageRepo.create({
              sessionId: this.options.sessionId,
              runId,
              role: msg.role,
              content: msg.content,
              reasoning: msg.role === "assistant" ? (msg.reasoning ?? null) : null,
              toolCalls: msg.role === "assistant" ? (msg.toolCalls ?? null) : null,
              toolCallId: msg.role === "tool" ? (msg.toolCallId ?? null) : null,
              sequenceNum: nextSeq,
              createdAt: Date.now(),
            });
          }
          runRepo.update(runId, {
            status: result.status === "cancelled" ? "cancelled" : "completed",
            completedAt: Date.now(),
          });
          sessionRepo.update(this.options.sessionId, {
            completedAt: Date.now(),
            updatedAt: Date.now(),
          });
        })();
      }

      if (this.sessionStore) {
        await this.sessionStore.save(session);
      }
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
