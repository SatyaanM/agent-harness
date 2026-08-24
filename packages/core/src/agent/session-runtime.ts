import { v4 as uuidv4 } from "uuid";
import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import { type PendingMessage, PendingMessageSchema } from "../contracts/session.js";
import { getTracer, SpanStatusCode } from "../contracts/tracing.js";

import type { LLMClient, LLMUsage } from "../llm/client.js";
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
import { Agent, type StreamPerformanceMetrics } from "./agent.js";
import { Compactor, estimateMessagesTokens } from "./compactor.js";
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
  | {
      sessionId: string;
      type: "agent:text-delta";
      agentName: string;
      text: string;
      runId: string;
      requestId?: string;
    }
  | {
      sessionId: string;
      type: "agent:tool-call-delta";
      agentName: string;
      toolCall: { id: string; name: string; argumentsDelta: string };
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
  | {
      type: "agent:text-delta";
      agentName: string;
      text: string;
      runId: string;
      requestId?: string;
    }
  | {
      type: "agent:tool-call-delta";
      agentName: string;
      toolCall: { id: string; name: string; argumentsDelta: string };
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

const DEFAULT_COMPACTION_THRESHOLD = 0.8;
const DEFAULT_CONTEXT_WINDOW_TOKENS = 128_000;
const DEFAULT_KEEP_RECENT_MESSAGES = 8;
const DEFAULT_COMPACTION_CHUNK_MESSAGES = 50;

export class SessionRuntime {
  private queue: Promise<unknown> = Promise.resolve();
  private listeners = new Set<(event: SessionRuntimeEvent) => void>();
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

  on(listener: (event: SessionRuntimeEvent) => void): void {
    this.listeners.add(listener);
  }

  off(listener: (event: SessionRuntimeEvent) => void): void {
    this.listeners.delete(listener);
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
    deliveryId?: string,
  ): Promise<AgentResult> {
    const run = this.queue.then(() =>
      this.runOnce(message, agentName, signal, false, requestId, deliveryId),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  /** Replay a user delivery already present in the durable transcript. */
  retry(
    message: string,
    agentName?: string,
    signal?: AbortSignal,
    requestId?: string,
    deliveryId?: string,
  ): Promise<AgentResult> {
    const run = this.queue.then(() =>
      this.runOnce(message, agentName, signal, true, requestId, deliveryId),
    );
    this.queue = run.catch(() => undefined);
    return run;
  }

  private emit(event: SessionRuntimeEventWithoutSession): void {
    const fullEvent: SessionRuntimeEvent = { sessionId: this.options.sessionId, ...event };
    this.options.onEvent?.(fullEvent);
    for (const listener of this.listeners) {
      try {
        listener(fullEvent);
      } catch (err) {
        this.logger.error("Error in SessionRuntime listener", { ...describeError(err) });
      }
    }
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
    deliveryId?: string,
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

    const tracer = getTracer();
    const deliverSpan = tracer.startSpan("session.deliver", {
      attributes: {
        "agent.session_id": this.options.sessionId,
        "agent.run_id": runId,
        "agent.request_id": requestId,
        "agent.name": agentName ?? "orchestrator",
        "agent.is_retry": Boolean(replayExistingUser),
      },
    });

    return tracer.withSpan(deliverSpan, async () => {
      try {
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
        if (deliveryId) {
          for (let index = persistedHistory.length - 1; index >= 0; index -= 1) {
            const candidate = persistedHistory[index];
            if (candidate?.role === "user" && candidate.deliveryId === deliveryId) {
              if (candidate.content !== message) {
                throw new Error("Delivery identity does not match the durable user message");
              }
              if (!replayExistingUser) {
                throw new Error("Delivery identity is already durable; retry is required");
              }
              replayedUserIndex = index;
              break;
            }
          }
        } else if (replayExistingUser) {
          // Compatibility for legacy clients that predate delivery identity.
          // Only the latest durable user can be replayed by content.
          for (let index = persistedHistory.length - 1; index >= 0; index -= 1) {
            const candidate = persistedHistory[index];
            if (candidate?.role !== "user") continue;
            if (candidate.content === message) replayedUserIndex = index;
            break;
          }
        }
        const isReplayingUser = replayedUserIndex !== -1;

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

          const drainSpan = tracer.startSpan("session.mailbox_drain", {
            attributes: {
              "agent.session_id": this.options.sessionId,
            },
          });

          try {
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
              drainSpan.setAttribute("agent.mailbox.pending_count", pendingEvents.length);
              const parsedPendingEvents: {
                evt: (typeof pendingEvents)[0];
                parsed: PendingMessage;
              }[] = [];
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
                  if (!isRecord(existing.meta) || existing.meta.kind !== "worker_completed")
                    return [];
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
              if (message && !isReplayingUser) {
                const existingDelivery = deliveryId ? messageRepo.get(deliveryId) : undefined;
                if (existingDelivery) {
                  if (
                    existingDelivery.session_id !== this.options.sessionId ||
                    existingDelivery.role !== "user" ||
                    existingDelivery.content !== message
                  ) {
                    throw new Error("Delivery identity conflicts with an existing durable message");
                  }
                  if (!replayExistingUser) {
                    throw new Error("Delivery identity is already durable; retry is required");
                  }
                } else {
                  const nextSeq = messageRepo.getNextSequenceNum(this.options.sessionId);
                  messageRepo.create({
                    ...(deliveryId ? { id: deliveryId } : {}),
                    sessionId: this.options.sessionId,
                    role: "user",
                    content: message,
                    sequenceNum: nextSeq,
                    createdAt: Date.now(),
                  });
                }
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
          } finally {
            drainSpan.end();
          }
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
          ...(message && !isReplayingUser
            ? [
                {
                  ...(deliveryId ? { deliveryId } : {}),
                  role: "user" as const,
                  content: message,
                  createdAt: now,
                },
              ]
            : []),
        ];
        session.mailbox = pending;

        if (!this.isAvailable()) {
          deliverSpan.setStatus({ code: SpanStatusCode.OK, message: "Session cancelled" });
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
          deliverSpan.setStatus({ code: SpanStatusCode.OK });
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
        const streamMetrics: StreamPerformanceMetrics[] = [];
        let modelHistory = [...baseHistory, ...deliveredSystem];
        let modelHistoryLength = modelHistory.length;
        let compactionTokenUsage: LLMUsage | undefined;
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
                .slice(modelHistoryLength + (message ? 1 : 0))
                .map((m) => ({ ...m, createdAt: m.createdAt ?? now }));
              this.emit({
                type: "session:updated",
                session: { ...session, messages: [...session.messages, ...liveAppended] },
              });
              return;
            }
            if (e.type === "text-delta") {
              this.emit({
                type: "agent:text-delta",
                agentName: agentConfig.name,
                text: e.text,
                runId,
                ...(requestId ? { requestId } : {}),
              });
              return;
            }
            if (e.type === "tool-call-delta") {
              this.emit({
                type: "agent:tool-call-delta",
                agentName: agentConfig.name,
                toolCall: e.toolCall,
                runId,
                ...(requestId ? { requestId } : {}),
              });
              return;
            }
            if (e.type === "tool:called" || e.type === "tool:completed") {
              const isCalled = e.type === "tool:called";
              this.emit({
                type: "agent:tool",
                agentName: agentConfig.name,
                tool: {
                  type: isCalled ? "called" : "completed",
                  toolName: e.toolName,
                  args: isCalled ? e.args : undefined,
                  result: !isCalled ? e.result : undefined,
                },
                runId,
                ...(requestId ? { requestId } : {}),
              });
              return;
            }
            if (e.type === "stream-metrics") {
              streamMetrics.push(e.metrics);
            }
          },
          logger,
        );

        let result: AgentResult;
        try {
          const execute = async () => {
            this.emit({ type: "agent:started", agentName: agentConfig.name, ...correlation });
            if (this.messageRepo) {
              const prepared = await this.prepareActiveContext(agentConfig, message, signal);
              modelHistory = prepared.history;
              modelHistoryLength = modelHistory.length;
              compactionTokenUsage = prepared.compactionTokenUsage;
            }
            return agent.run(message, modelHistory, signal);
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
            .slice(modelHistoryLength + (message ? 1 : 0))
            .map((entry) => ({ ...entry, createdAt: entry.createdAt ?? new Date().toISOString() }));

          await this.persistRunCompletion(
            session,
            runId,
            partial,
            isCancelled ? "cancelled" : "failed",
            isCancelled ? "cancelled" : isBudgetExceeded ? "budgetExceeded" : "error",
            errorMessage,
            correlation,
            agentConfig.name,
            errorCode,
            streamMetrics,
            compactionTokenUsage,
          );

          this.emit({
            type: "agent:error",
            agentName: agentConfig.name,
            error: errorMessage,
            code: errorCode,
            ...correlation,
          });
          deliverSpan.setStatus({
            code: isCancelled ? SpanStatusCode.OK : SpanStatusCode.ERROR,
            message: errorMessage,
          });
          throw error;
        }

        // Persist the full run record — every assistant message (with tool calls
        // and reasoning) and every tool result — so the transcript is a complete
        // audit of what the agent did. Slice off the history that was passed in
        // (baseHistory + deliveredSystem + the prompt agent.run re-added), keeping
        // only the messages this run actually produced.
        const appended = result.messages
          .slice(modelHistoryLength + (message ? 1 : 0))
          .map((m) => ({ ...m, createdAt: m.createdAt ?? now }));

        await this.persistRunCompletion(
          session,
          runId,
          appended,
          result.status === "cancelled" ? "cancelled" : "completed",
          result.status,
          result.summary,
          correlation,
          agentConfig.name,
          undefined,
          streamMetrics,
          compactionTokenUsage,
        );

        if (this.isAvailable()) {
          this.emit({
            type: "agent:completed",
            agentName: agentConfig.name,
            status: result.status,
            ...correlation,
          });
          this.emit({ type: "session:updated", session });
        }

        deliverSpan.setStatus({
          code: result.status === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
        });
        return result;
      } finally {
        deliverSpan.end();
      }
    });
  }

  private async persistRunCompletion(
    session: SessionData,
    runId: string,
    messagesToPersist: Message[],
    runStatus: "completed" | "cancelled" | "failed",
    sessionResultStatus: "success" | "error" | "cancelled" | "maxStepsReached" | "budgetExceeded",
    summary: string,
    correlation: RunCorrelation,
    agentName: string,
    errorCode?: string,
    streamMetrics: StreamPerformanceMetrics[] = [],
    compactionTokenUsage?: LLMUsage,
  ): Promise<void> {
    session.messages.push(...messagesToPersist);
    session.result = { status: sessionResultStatus, summary };
    session.completedAt = new Date().toISOString();

    if (!this.isAvailable()) return;

    if (this.db && this.runRepo && this.sessionRepo && this.messageRepo) {
      const runRepo = this.runRepo;
      const sessionRepo = this.sessionRepo;
      const messageRepo = this.messageRepo;
      this.db.immediateTransaction(() => {
        for (const msg of messagesToPersist) {
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
          status: runStatus,
          tokenUsage:
            streamMetrics.length > 0 || compactionTokenUsage
              ? {
                  ...(streamMetrics.length > 0
                    ? { streaming: { steps: streamMetrics } }
                    : {}),
                  ...(compactionTokenUsage ? { compactionTokenUsage } : {}),
                }
              : undefined,
          errorCode: errorCode ?? null,
          errorMessage: runStatus === "failed" ? summary : null,
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
        if (runStatus === "failed") {
          this.emit({ type: "session:updated", session });
        }
      } catch (persistenceError) {
        if (runStatus === "failed") {
          const persistenceMessage =
            persistenceError instanceof Error ? persistenceError.message : String(persistenceError);
          this.emit({
            type: "agent:error",
            agentName,
            error: `Failed to persist partial run: ${persistenceMessage}`,
            code: describeError(persistenceError).code,
            ...correlation,
          });
        } else {
          throw persistenceError;
        }
      }
    }
  }

  private async prepareActiveContext(
    agentConfig: AgentConfig,
    deliveredPrompt: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ history: Message[]; compactionTokenUsage?: LLMUsage }> {
    const messageRepo = this.messageRepo;
    if (!messageRepo) return { history: [] };

    const contextWindowTokens =
      agentConfig.capabilities?.maxTokens && agentConfig.capabilities.maxTokens > 0
        ? agentConfig.capabilities.maxTokens
        : DEFAULT_CONTEXT_WINDOW_TOKENS;
    const threshold = agentConfig.compactionThreshold ?? DEFAULT_COMPACTION_THRESHOLD;
    const activeRows = messageRepo.getActiveContext(this.options.sessionId);
    const activeMessages = activeRows.map((row) => messageRepo.toMessage(row));

    let compactionTokenUsage: LLMUsage | undefined;
    if (
      agentConfig.compaction !== false &&
      estimateMessagesTokens(activeMessages) > contextWindowTokens * threshold
    ) {
      const candidate = messageRepo.selectCompactionCandidate(this.options.sessionId, {
        keepRecentMessages:
          agentConfig.compactionKeepRecentMessages ?? DEFAULT_KEEP_RECENT_MESSAGES,
        chunkMessages: agentConfig.compactionChunkMessages ?? DEFAULT_COMPACTION_CHUNK_MESSAGES,
      });
      const first = candidate[0];
      const last = candidate.at(-1);
      if (first && last) {
        const compacted = await new Compactor(this.options.llmClient).compact(
          candidate.map((row) => messageRepo.toMessage(row)),
          agentConfig.model,
          signal,
        );
        messageRepo.createCompaction({
          sessionId: this.options.sessionId,
          summaryContent: compacted.summary,
          startSequence: first.sequence_num,
          endSequence: last.sequence_num,
          originalTokenEstimate: compacted.originalTokenEstimate,
          summaryTokenEstimate: compacted.summaryTokenEstimate,
          compactedAt: Date.now(),
          modelUsed: agentConfig.model,
        });
        compactionTokenUsage = compacted.usage;
      }
    }

    const refreshed = messageRepo
      .getActiveContext(this.options.sessionId)
      .map((row) => ({ row, message: messageRepo.toMessage(row) }));
    if (deliveredPrompt) {
      for (let index = refreshed.length - 1; index >= 0; index -= 1) {
        const entry = refreshed[index];
        if (entry?.message.role === "user" && entry.message.content === deliveredPrompt) {
          refreshed.splice(index, 1);
          break;
        }
      }
    }
    return {
      history: refreshed.map((entry) => entry.message),
      ...(compactionTokenUsage ? { compactionTokenUsage } : {}),
    };
  }
}
