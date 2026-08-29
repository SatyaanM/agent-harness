import { v4 as uuidv4 } from "uuid";
import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger, type Logger } from "../contracts/logging.js";
import { type PendingMessage, PendingMessageSchema } from "../contracts/session.js";
import { getTracer, type ISpan, SpanStatusCode } from "../contracts/tracing.js";

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
import { Agent, type AgentEventCallback, type StreamPerformanceMetrics } from "./agent.js";
import { CompactionResponseError, Compactor, estimateMessagesTokens } from "./compactor.js";
import {
  AgentBudgetExceededError,
  AgentCancelledError,
  type AgentConfig,
  type AgentResult,
  type CapabilityMatrix,
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

interface RunRequestContext {
  message?: string;
  agentName?: string;
  signal?: AbortSignal;
  replayExistingUser: boolean;
  requestId?: string;
  deliveryId?: string;
  runId: string;
  correlation: RunCorrelation;
  logger: Logger;
  deliverSpan: ISpan;
}

interface PreparedRun {
  session: SessionData;
  now: string;
  baseHistory: Message[];
  deliveredSystem: Message[];
}

interface ActiveRunState {
  session: SessionData;
  now: string;
  baseHistory: Message[];
  deliveredSystem: Message[];
  modelHistory: Message[];
  modelHistoryLength: number;
  hasMessage: boolean;
  agentConfig: AgentConfig;
  latestRunMessages?: Message[];
  streamMetrics: StreamPerformanceMetrics[];
  compactionTokenUsage?: LLMUsage;
}

interface DatabaseRepositories {
  db: ISqliteDatabase;
  sessionRepo: SessionRepository;
  messageRepo: MessageRepository;
  runRepo: RunRepository;
  mailboxRepo: MailboxRepository;
}

type MailboxEventRow = ReturnType<MailboxRepository["peekPending"]>[number];

interface ParsedMailboxEvent {
  event: MailboxEventRow;
  message: PendingMessage;
}

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

    return tracer.withSpan(deliverSpan, () =>
      this.executeRun({
        message,
        agentName,
        signal,
        replayExistingUser,
        requestId,
        deliveryId,
        runId,
        correlation,
        logger,
        deliverSpan,
      }),
    );
  }

  private async executeRun(context: RunRequestContext): Promise<AgentResult> {
    try {
      const prepared = await this.prepareRun(context);
      if (!this.isAvailable()) {
        context.deliverSpan.setStatus({ code: SpanStatusCode.OK, message: "Session cancelled" });
        return {
          status: "cancelled",
          summary: "Session is no longer available",
          messages: [...prepared.session.messages],
        };
      }

      await this.persistInitialSession(prepared);
      if (!context.message && prepared.deliveredSystem.length === 0) {
        context.deliverSpan.setStatus({ code: SpanStatusCode.OK });
        return {
          status: "success",
          summary: "",
          messages: [...prepared.session.messages],
        };
      }
      return this.executeAgentRun(prepared, context);
    } finally {
      context.deliverSpan.end();
    }
  }

  private async prepareRun(context: RunRequestContext): Promise<PreparedRun> {
    const now = new Date().toISOString();
    const session = await this.loadOrCreateSession(context, now);
    const persistedHistory = [...session.messages];
    if (context.agentName) session.agentName = context.agentName;
    if (context.message) session.prompt = context.message;

    const replayedUserIndex = findReplayedUserIndex(
      persistedHistory,
      context.message,
      context.deliveryId,
      context.replayExistingUser,
    );
    const baseHistory =
      replayedUserIndex === -1
        ? persistedHistory
        : [
            ...persistedHistory.slice(0, replayedUserIndex),
            ...persistedHistory.slice(replayedUserIndex + 1),
          ];

    const isReplayingUser = replayedUserIndex !== -1;
    const pending = await this.drainPending(context, session, baseHistory, isReplayingUser);
    const materializedTasks = materializedTaskIds(baseHistory);
    const delivered = pending.filter((entry) => !materializedTasks.has(entry.taskId));
    const deliveredSystem = delivered.map((entry) => pendingMessageToSystem(entry));
    session.messages = [
      ...persistedHistory,
      ...deliveredSystem,
      ...(context.message && !isReplayingUser
        ? [
            {
              ...(context.deliveryId ? { deliveryId: context.deliveryId } : {}),
              role: "user" as const,
              content: context.message,
              createdAt: now,
            },
          ]
        : []),
    ];
    session.mailbox = pending;
    return { session, now, baseHistory, deliveredSystem };
  }

  private async loadOrCreateSession(context: RunRequestContext, now: string): Promise<SessionData> {
    const loaded = this.sessionStore ? await this.sessionStore.load(this.options.sessionId) : null;
    return (
      loaded ?? {
        sessionId: this.options.sessionId,
        taskId: uuidv4(),
        prompt: context.message ?? "",
        agentName: context.agentName ?? "orchestrator",
        messages: [],
        mailbox: [],
        createdAt: now,
      }
    );
  }

  private async drainPending(
    context: RunRequestContext,
    session: SessionData,
    baseHistory: Message[],
    isReplayingUser: boolean,
  ): Promise<PendingMessage[]> {
    const repositories = this.databaseRepositories();
    if (repositories) {
      return this.drainDatabaseMailbox(
        context,
        session,
        baseHistory,
        isReplayingUser,
        repositories,
      );
    }
    if (this.sessionStore) {
      return (await this.sessionStore.peekMailbox(this.options.sessionId)) ?? [];
    }
    return [];
  }

  private databaseRepositories(): DatabaseRepositories | undefined {
    if (!this.db || !this.sessionRepo || !this.messageRepo || !this.runRepo || !this.mailboxRepo) {
      return undefined;
    }
    return {
      db: this.db,
      sessionRepo: this.sessionRepo,
      messageRepo: this.messageRepo,
      runRepo: this.runRepo,
      mailboxRepo: this.mailboxRepo,
    };
  }

  private drainDatabaseMailbox(
    context: RunRequestContext,
    session: SessionData,
    baseHistory: Message[],
    isReplayingUser: boolean,
    repositories: DatabaseRepositories,
  ): PendingMessage[] {
    const tracer = getTracer();
    const drainSpan = tracer.startSpan("session.mailbox_drain", {
      attributes: {
        "agent.session_id": this.options.sessionId,
      },
    });
    let pending: PendingMessage[] = [];
    try {
      repositories.db.immediateTransaction(() => {
        pending = this.drainMailboxTransaction(
          context,
          session,
          baseHistory,
          isReplayingUser,
          repositories,
          drainSpan,
        );
      })();
    } finally {
      drainSpan.end();
    }
    return pending;
  }

  private drainMailboxTransaction(
    context: RunRequestContext,
    session: SessionData,
    baseHistory: Message[],
    isReplayingUser: boolean,
    repositories: DatabaseRepositories,
    drainSpan: ISpan,
  ): PendingMessage[] {
    this.ensureDatabaseSession(session, context, repositories.sessionRepo);
    const parsedEvents = this.parsePendingEvents(
      repositories.mailboxRepo.peekPending(this.options.sessionId),
    );
    drainSpan.setAttribute("agent.mailbox.pending_count", parsedEvents.length);
    this.materializePendingEvents(parsedEvents, baseHistory, repositories);
    insertDurableUserMessage(
      context,
      this.options.sessionId,
      isReplayingUser,
      repositories.messageRepo,
    );
    repositories.runRepo.create({
      runId: context.runId,
      sessionId: this.options.sessionId,
      requestId: context.requestId ?? null,
      status: "running",
      startedAt: Date.now(),
    });
    repositories.sessionRepo.update(this.options.sessionId, {
      updatedAt: Date.now(),
      prompt: context.message ?? undefined,
    });
    return parsedEvents.map((entry) => entry.message);
  }

  private ensureDatabaseSession(
    session: SessionData,
    context: RunRequestContext,
    sessionRepo: SessionRepository,
  ): void {
    if (sessionRepo.get(this.options.sessionId)) return;
    sessionRepo.create({
      id: this.options.sessionId,
      agentName: session.agentName ?? "orchestrator",
      prompt: context.message ?? "",
      createdAt: Date.now(),
    });
  }

  private parsePendingEvents(events: MailboxEventRow[]): ParsedMailboxEvent[] {
    return events.map((event) => ({
      event,
      message: parseJsonBoundary(PendingMessageSchema, event.payload, `mailbox_event ${event.id}`),
    }));
  }

  private materializePendingEvents(
    parsedEvents: ParsedMailboxEvent[],
    baseHistory: Message[],
    repositories: DatabaseRepositories,
  ): void {
    const existingTaskIds = materializedTaskIds(baseHistory);
    for (const { event, message } of parsedEvents) {
      if (!existingTaskIds.has(message.taskId)) {
        const nextSeq = repositories.messageRepo.getNextSequenceNum(this.options.sessionId);
        repositories.messageRepo.create({
          sessionId: this.options.sessionId,
          role: "system",
          content: pendingMessageContent(message),
          sequenceNum: nextSeq,
          createdAt: Date.now(),
          metadata: { meta: pendingMessageMeta(message) },
        });
        existingTaskIds.add(message.taskId);
      }
      repositories.mailboxRepo.acknowledge(event.id);
    }
  }

  private async persistInitialSession(prepared: PreparedRun): Promise<void> {
    if (!this.sessionStore) return;
    await this.sessionStore.save(prepared.session);
    if (prepared.session.mailbox && prepared.session.mailbox.length > 0 && this.isAvailable()) {
      try {
        await this.sessionStore.acknowledgeMailbox(
          this.options.sessionId,
          prepared.session.mailbox.map((entry) => entry.taskId),
        );
        prepared.session.mailbox = [];
      } catch (ackError) {
        this.logger.warn("Failed to acknowledge mailbox", { ...describeError(ackError) });
      }
    }
  }

  private async executeAgentRun(
    prepared: PreparedRun,
    context: RunRequestContext,
  ): Promise<AgentResult> {
    const agentConfig = this.options.resolveConfig(prepared.session.agentName);
    const runConfig = {
      ...agentConfig,
      tools: context.message
        ? agentConfig.tools
        : agentConfig.tools.filter((toolName) => toolName !== "delegate"),
    };
    const state: ActiveRunState = {
      session: prepared.session,
      now: prepared.now,
      baseHistory: prepared.baseHistory,
      deliveredSystem: prepared.deliveredSystem,
      modelHistory: [...prepared.baseHistory, ...prepared.deliveredSystem],
      modelHistoryLength: prepared.baseHistory.length + prepared.deliveredSystem.length,
      hasMessage: Boolean(context.message),
      agentConfig,
      streamMetrics: [],
    };
    const agent = new Agent(
      runConfig,
      this.options.toolRegistry,
      this.options.llmClient,
      this.options.capabilityRegistry,
      (event) => this.handleAgentEvent(event, state, context),
      context.logger,
    );

    let result: AgentResult;
    try {
      result = await this.runAgent(agent, state, context);
    } catch (error) {
      await this.handleAgentFailure(error, state, context);
      throw error;
    }
    return this.completeAgentRun(result, state, context);
  }

  private async runAgent(
    agent: Agent,
    state: ActiveRunState,
    context: RunRequestContext,
  ): Promise<AgentResult> {
    const execute = () => this.executeAgent(agent, state, context);
    return this.options.executionLimiter
      ? this.options.executionLimiter.run(execute, context.signal)
      : execute();
  }

  private async executeAgent(
    agent: Agent,
    state: ActiveRunState,
    context: RunRequestContext,
  ): Promise<AgentResult> {
    this.emit({
      type: "agent:started",
      agentName: state.agentConfig.name,
      ...context.correlation,
    });
    const resolvedCapabilities = await agent.resolveCapabilities();
    if (this.messageRepo) {
      const prepared = await this.prepareActiveContext(
        state.agentConfig,
        resolvedCapabilities,
        context.message,
        context.signal,
      );
      state.modelHistory = prepared.history;
      state.modelHistoryLength = prepared.history.length;
      state.compactionTokenUsage = prepared.compactionTokenUsage;
    }
    return agent.run(context.message, state.modelHistory, context.signal, resolvedCapabilities);
  }

  private async handleAgentFailure(
    error: unknown,
    state: ActiveRunState,
    context: RunRequestContext,
  ): Promise<void> {
    if (error instanceof CompactionResponseError && error.usage) {
      state.compactionTokenUsage = error.usage;
    }
    const errorDetails = describeError(error);
    const isCancelled = isAgentCancellation(error, context.signal);
    const isBudgetExceeded = error instanceof AgentBudgetExceededError;
    context.logger.error("Agent run failed", {
      code: errorDetails.code,
      cancelled: isCancelled,
    });

    const partial = sliceRunMessages(
      state.latestRunMessages ?? [],
      state.modelHistoryLength,
      Boolean(context.message),
    ).map((entry) => ({
      ...entry,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    }));
    await this.persistRunCompletion(
      state.session,
      context.runId,
      partial,
      isCancelled ? "cancelled" : "failed",
      isCancelled ? "cancelled" : isBudgetExceeded ? "budgetExceeded" : "error",
      errorDetails.message,
      context.correlation,
      state.agentConfig.name,
      errorDetails.code,
      state.streamMetrics,
      state.compactionTokenUsage,
    );
    this.emit({
      type: "agent:error",
      agentName: state.agentConfig.name,
      error: errorDetails.message,
      code: errorDetails.code,
      ...context.correlation,
    });
    context.deliverSpan.setStatus({
      code: isCancelled ? SpanStatusCode.OK : SpanStatusCode.ERROR,
      message: errorDetails.message,
    });
  }

  private async completeAgentRun(
    result: AgentResult,
    state: ActiveRunState,
    context: RunRequestContext,
  ): Promise<AgentResult> {
    const appended = sliceRunMessages(
      result.messages,
      state.modelHistoryLength,
      Boolean(context.message),
    ).map((message) => ({
      ...message,
      createdAt: message.createdAt ?? state.now,
    }));
    await this.persistRunCompletion(
      state.session,
      context.runId,
      appended,
      result.status === "cancelled" ? "cancelled" : "completed",
      result.status,
      result.summary,
      context.correlation,
      state.agentConfig.name,
      undefined,
      state.streamMetrics,
      state.compactionTokenUsage,
    );
    if (this.isAvailable()) {
      this.emit({
        type: "agent:completed",
        agentName: state.agentConfig.name,
        status: result.status,
        ...context.correlation,
      });
      this.emit({ type: "session:updated", session: state.session });
    }
    context.deliverSpan.setStatus({
      code: result.status === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
    });
    return result;
  }

  private handleAgentEvent(
    event: Parameters<AgentEventCallback>[0],
    state: ActiveRunState,
    context: RunRequestContext,
  ): void {
    switch (event.type) {
      case "step":
        this.handleStepEvent(event, state);
        return;
      case "text-delta":
        this.emit({
          type: "agent:text-delta",
          agentName: state.agentConfig.name,
          text: event.text,
          runId: context.runId,
          ...(context.requestId ? { requestId: context.requestId } : {}),
        });
        return;
      case "tool-call-delta":
        this.emit({
          type: "agent:tool-call-delta",
          agentName: state.agentConfig.name,
          toolCall: event.toolCall,
          runId: context.runId,
          ...(context.requestId ? { requestId: context.requestId } : {}),
        });
        return;
      case "tool:called":
      case "tool:completed":
        this.emitAgentToolEvent(event, state.agentConfig.name, context);
        return;
      case "stream-metrics":
        state.streamMetrics.push(event.metrics);
        return;
      default:
        return;
    }
  }

  private handleStepEvent(
    event: Extract<Parameters<AgentEventCallback>[0], { type: "step" }>,
    state: ActiveRunState,
  ): void {
    state.latestRunMessages = event.messages;
    const liveAppended = sliceRunMessages(
      event.messages,
      state.modelHistoryLength,
      state.hasMessage,
    ).map((message) => ({
      ...message,
      createdAt: message.createdAt ?? state.now,
    }));
    this.emit({
      type: "session:updated",
      session: { ...state.session, messages: [...state.session.messages, ...liveAppended] },
    });
  }

  private emitAgentToolEvent(
    event: Extract<Parameters<AgentEventCallback>[0], { type: "tool:called" | "tool:completed" }>,
    agentName: string,
    context: RunRequestContext,
  ): void {
    const isCalled = event.type === "tool:called";
    this.emit({
      type: "agent:tool",
      agentName,
      tool: {
        type: isCalled ? "called" : "completed",
        toolName: event.toolName,
        args: isCalled ? event.args : undefined,
        result: !isCalled ? event.result : undefined,
      },
      runId: context.runId,
      ...(context.requestId ? { requestId: context.requestId } : {}),
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

    const repositories = this.databaseRepositories();
    if (repositories) {
      this.persistRunInDatabase(
        repositories,
        runId,
        messagesToPersist,
        runStatus,
        summary,
        errorCode,
        streamMetrics,
        compactionTokenUsage,
      );
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

  private persistRunInDatabase(
    repositories: DatabaseRepositories,
    runId: string,
    messagesToPersist: Message[],
    runStatus: "completed" | "cancelled" | "failed",
    summary: string,
    errorCode: string | undefined,
    streamMetrics: StreamPerformanceMetrics[],
    compactionTokenUsage: LLMUsage | undefined,
  ): void {
    repositories.db.immediateTransaction(() => {
      persistMessages(repositories.messageRepo, this.options.sessionId, runId, messagesToPersist);
      repositories.runRepo.update(runId, {
        status: runStatus,
        tokenUsage: buildRunTokenUsage(streamMetrics, compactionTokenUsage),
        errorCode: errorCode ?? null,
        errorMessage: runStatus === "failed" ? summary : null,
        completedAt: Date.now(),
      });
      repositories.sessionRepo.update(this.options.sessionId, {
        completedAt: Date.now(),
        updatedAt: Date.now(),
      });
    })();
  }

  private async prepareActiveContext(
    agentConfig: AgentConfig,
    resolvedCapabilities: CapabilityMatrix,
    deliveredPrompt: string | undefined,
    signal: AbortSignal | undefined,
  ): Promise<{ history: Message[]; compactionTokenUsage?: LLMUsage }> {
    const messageRepo = this.messageRepo;
    if (!messageRepo) return { history: [] };

    const contextWindowTokens =
      positiveCapability(resolvedCapabilities.contextWindowTokens) ?? DEFAULT_CONTEXT_WINDOW_TOKENS;
    const maxOutputTokens = positiveCapability(resolvedCapabilities.maxTokens);
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
          {
            contextWindowTokens,
            maxOutputTokens,
            preferredProviderId: agentConfig.provider,
            signal,
          },
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

function findReplayedUserIndex(
  persistedHistory: Message[],
  message: string | undefined,
  deliveryId: string | undefined,
  replayExistingUser: boolean,
): number {
  if (deliveryId) {
    for (let index = persistedHistory.length - 1; index >= 0; index -= 1) {
      const candidate = persistedHistory[index];
      if (candidate?.role !== "user" || candidate.deliveryId !== deliveryId) continue;
      if (candidate.content !== message) {
        throw new Error("Delivery identity does not match the durable user message");
      }
      if (!replayExistingUser) {
        throw new Error("Delivery identity is already durable; retry is required");
      }
      return index;
    }
  }

  if (replayExistingUser && !deliveryId) {
    for (let index = persistedHistory.length - 1; index >= 0; index -= 1) {
      const candidate = persistedHistory[index];
      if (candidate?.role !== "user") continue;
      return candidate.content === message ? index : -1;
    }
  }
  return -1;
}

function materializedTaskIds(history: Message[]): Set<string> {
  const taskIds = new Set<string>();
  for (const existing of history) {
    if (!isRecord(existing.meta) || existing.meta.kind !== "worker_completed") continue;
    if (typeof existing.meta.taskId === "string") taskIds.add(existing.meta.taskId);
  }
  return taskIds;
}

function pendingMessageStatusText(status: PendingMessage["status"]): string {
  if (status === "done") return "completed with the result below";
  if (status === "cancelled") return "was cancelled by the user";
  return "failed with the error below";
}

function pendingMessageContent(pending: PendingMessage): string {
  return (
    `Worker "${pending.agentName}" (task ${pending.taskId}) ` +
    `${pendingMessageStatusText(pending.status)}. ${pending.summary}\n\n` +
    "This is the final result of the task you delegated. Present it to the user. " +
    "Do not delegate this task again."
  );
}

function pendingMessageMeta(pending: PendingMessage): Record<string, string> {
  return {
    kind: "worker_completed",
    taskId: pending.taskId,
    agentName: pending.agentName,
    status: pending.status,
    summary: pending.summary,
  };
}

function pendingMessageToSystem(pending: PendingMessage): Message {
  return {
    role: "system",
    content: pendingMessageContent(pending),
    createdAt: pending.receivedAt,
    meta: pendingMessageMeta(pending),
  };
}

function insertDurableUserMessage(
  context: RunRequestContext,
  sessionId: string,
  isReplayingUser: boolean,
  messageRepo: MessageRepository,
): void {
  const message = context.message;
  if (!message || isReplayingUser) return;

  const existingDelivery = context.deliveryId ? messageRepo.get(context.deliveryId) : undefined;
  if (existingDelivery) {
    if (
      existingDelivery.session_id !== sessionId ||
      existingDelivery.role !== "user" ||
      existingDelivery.content !== message
    ) {
      throw new Error("Delivery identity conflicts with an existing durable message");
    }
    if (!context.replayExistingUser) {
      throw new Error("Delivery identity is already durable; retry is required");
    }
    return;
  }

  const nextSeq = messageRepo.getNextSequenceNum(sessionId);
  messageRepo.create({
    ...(context.deliveryId ? { id: context.deliveryId } : {}),
    sessionId,
    role: "user",
    content: message,
    sequenceNum: nextSeq,
    createdAt: Date.now(),
  });
}

function isAgentCancellation(error: unknown, signal: AbortSignal | undefined): boolean {
  return (
    error instanceof AgentCancelledError ||
    (error instanceof DOMException && error.name === "AbortError") ||
    Boolean(signal?.aborted)
  );
}

function sliceRunMessages(
  messages: Message[],
  modelHistoryLength: number,
  hasMessage: boolean,
): Message[] {
  return messages.slice(modelHistoryLength + (hasMessage ? 1 : 0));
}

function persistMessages(
  messageRepo: MessageRepository,
  sessionId: string,
  runId: string,
  messages: Message[],
): void {
  for (const message of messages) {
    const nextSeq = messageRepo.getNextSequenceNum(sessionId);
    messageRepo.create({
      sessionId,
      runId,
      role: message.role,
      content: message.content,
      reasoning: message.role === "assistant" ? (message.reasoning ?? null) : null,
      toolCalls: message.role === "assistant" ? (message.toolCalls ?? null) : null,
      toolCallId: message.role === "tool" ? (message.toolCallId ?? null) : null,
      sequenceNum: nextSeq,
      createdAt: Date.now(),
    });
  }
}

function buildRunTokenUsage(
  streamMetrics: StreamPerformanceMetrics[],
  compactionTokenUsage: LLMUsage | undefined,
): Record<string, unknown> | undefined {
  if (streamMetrics.length === 0 && !compactionTokenUsage) return undefined;
  return {
    ...(streamMetrics.length > 0 ? { streaming: { steps: streamMetrics } } : {}),
    ...(compactionTokenUsage ? { compactionTokenUsage } : {}),
  };
}

function positiveCapability(value: number | undefined): number | undefined {
  return value !== undefined && value > 0 ? value : undefined;
}
