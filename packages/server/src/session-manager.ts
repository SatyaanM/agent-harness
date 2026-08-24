import path from "node:path";
import type {
  AgentConfig,
  AppendAuditEventInput,
  ISqliteDatabase,
  PendingMessage,
  SessionRuntimeEvent,
} from "@agent-harness/core";
import {
  AuditRepository,
  CapabilityRegistry,
  createDatabaseConnection,
  createDelegateTool,
  createEditFileTool,
  createListDirectoryTool,
  createLogger,
  createReadFileTool,
  createReadSessionTool,
  createVercelAILLMClient,
  createWriteFileTool,
  describeError,
  ExecutionLimiter,
  getConfig,
  globTool,
  grepTool,
  isRecord,
  LegacyMigrator,
  loadAgentConfig,
  MailboxRepository,
  ProviderRuntimeState,
  runCommandTool,
  SessionRepository,
  SessionRuntime,
  SqliteMigrator,
  TaskRepository,
  ToolRegistry,
  webFetchTool,
} from "@agent-harness/core";
import { parseServerConfig } from "./server-config.js";
import { emitAgentEvent } from "./ws/events.js";

const logger = createLogger("server.session-manager");

export function resolveAgentConfig(agentName: string | undefined): AgentConfig {
  const config = getConfig();
  const name = agentName || "orchestrator";
  try {
    const agentConfig = loadAgentConfig(path.join(config.AGENTS_DIR, `${name}.md`));
    if (agentConfig.model === "DEFAULT") agentConfig.model = config.DEFAULT_MODEL;
    return agentConfig;
  } catch {
    try {
      const orchestratorConfig = loadAgentConfig(path.join(config.AGENTS_DIR, "orchestrator.md"));
      if (orchestratorConfig.model === "DEFAULT") {
        orchestratorConfig.model = config.DEFAULT_MODEL;
      }
      return orchestratorConfig;
    } catch {
      return {
        name: "orchestrator",
        model: config.DEFAULT_MODEL,
        tools: [],
        maxSteps: 10,
        instructions: "You are a helpful orchestrator agent.",
      };
    }
  }
}

export class SessionManager {
  private runtimes = new Map<string, SessionRuntime>();
  private sessionControllers = new Map<string, Set<AbortController>>();
  private workerControllers = new Map<
    string,
    { controller: AbortController; parentSessionId: string }
  >();
  private deletedSessions = new Set<string>();
  private executionLimiter: ExecutionLimiter | undefined;
  private providerRuntime: ProviderRuntimeState | undefined;
  private providerReconfiguration: Promise<void> | undefined;
  private closeOperation: Promise<void> | undefined;
  private lifecycleWaiters = new Set<() => void>();
  private backgroundDeliveries = new Set<Promise<unknown>>();
  private db: ISqliteDatabase | undefined;

  async initialize(customDb?: ISqliteDatabase): Promise<void> {
    if (this.closeOperation) await this.closeOperation;
    const config = getConfig();
    if (customDb) {
      this.db = customDb;
    } else {
      const dbPath = path.join(config.SESSIONS_DIR, ".harness", "harness.db");
      this.db = createDatabaseConnection(dbPath);
    }

    // Run schema migrations
    const migrator = new SqliteMigrator(this.db);
    migrator.up();

    // Run legacy data migration if needed
    const legacyMigrator = new LegacyMigrator(this.db, config.SESSIONS_DIR);
    legacyMigrator.migrate();

    // Startup worker reconciliation protocol
    this.reconcileOrphanedTasks();
  }

  getDb(): ISqliteDatabase | undefined {
    return this.db;
  }

  getAuditRepo(): AuditRepository | undefined {
    return this.db ? new AuditRepository(this.db) : undefined;
  }

  audit(input: AppendAuditEventInput): void {
    if (!this.db) return;
    try {
      const repo = new AuditRepository(this.db);
      repo.append(input);
    } catch (err) {
      logger.error("Failed to append audit event", {
        action: input.action,
        actorId: input.actorId,
        ...describeError(err),
      });
    }
  }

  async close(): Promise<void> {
    if (this.closeOperation) {
      await this.closeOperation;
      return;
    }
    const operation = this.performClose();
    this.closeOperation = operation;
    try {
      await operation;
    } finally {
      this.closeOperation = undefined;
    }
  }

  private async performClose(): Promise<void> {
    if (this.providerReconfiguration) await this.providerReconfiguration;
    const reset = this.resetRuntimeGeneration(
      new DOMException("Server is shutting down", "AbortError"),
    );
    this.providerReconfiguration = reset;
    try {
      await reset;
      this.executionLimiter = undefined;
      this.deletedSessions.clear();
      const db = this.db;
      this.db = undefined;
      db?.close();
    } finally {
      this.providerReconfiguration = undefined;
    }
  }

  private reconcileOrphanedTasks(): void {
    if (!this.db) return;

    const taskRepo = new TaskRepository(this.db);
    const mailboxRepo = new MailboxRepository(this.db);
    const sessionRepo = new SessionRepository(this.db);

    const orphaned = taskRepo.listByStatus(["running", "queued"]);
    for (const task of orphaned) {
      const now = Date.now();
      const workerSession = task.worker_session_id
        ? sessionRepo.get(task.worker_session_id)
        : undefined;

      const pending: PendingMessage = {
        taskId: task.task_id,
        from: task.worker_session_id ?? `worker-${task.task_id}`,
        agentName: workerSession?.agent_name ?? "worker",
        status: "error",
        summary: "Task was abandoned due to an ungraceful server termination or process crash.",
        receivedAt: new Date(now).toISOString(),
      };

      this.db.immediateTransaction(() => {
        const updated = taskRepo.update(task.task_id, {
          status: "abandoned",
          completedAt: now,
          updatedAt: now,
          errorCode: "TASK_ABANDONED_ON_STARTUP",
          errorMessage:
            "Task was abandoned due to an ungraceful server termination or process crash.",
        });
        if (!updated) throw new Error(`Orphaned task ${task.task_id} disappeared during startup`);

        mailboxRepo.enqueue({
          parentSessionId: task.parent_session_id,
          taskId: task.task_id,
          eventType: "worker_abandoned",
          payload: pending,
          createdAt: now,
        });
      })();

      // Emit only after both durable writes commit. A failed enqueue rolls the
      // task transition back so the next startup can retry the whole unit.
      this.onWorkerCompleted(task.parent_session_id, pending);
    }
  }

  getOrCreate(sessionId: string): SessionRuntime {
    if (this.closeOperation) {
      throw new Error("Session manager is closing");
    }
    if (this.providerReconfiguration) {
      throw new Error("Provider settings reconfiguration is in progress");
    }
    if (!this.isSessionAvailable(sessionId)) {
      throw new Error(`Session ${sessionId} was deleted`);
    }
    const config = getConfig();
    const executionLimiter = this.getExecutionLimiter(config.MAX_CONCURRENT_AGENTS);
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      this.providerRuntime ??= new ProviderRuntimeState(config);
      const llmClient = createVercelAILLMClient(config, this.providerRuntime);
      const capabilityRegistry = new CapabilityRegistry({
        workspaceRoot: config.ROOT,
        baseUrl: config.PROVIDER_ENDPOINT,
      });
      runtime = new SessionRuntime({
        sessionId,
        sessionsDir: config.SESSIONS_DIR,
        db: this.db,
        resolveConfig: resolveAgentConfig,
        toolRegistry: this.buildToolRegistry(
          sessionId,
          llmClient,
          capabilityRegistry,
          executionLimiter,
        ),
        llmClient,
        capabilityRegistry,
        executionLimiter,
        onEvent: (event) => this.handleRuntimeEvent(event),
        isSessionAvailable: (id) => this.isSessionAvailable(id),
      });
      this.runtimes.set(sessionId, runtime);
    }
    return runtime;
  }

  isLoaded(sessionId: string): boolean {
    return this.runtimes.has(sessionId);
  }

  unload(sessionId: string): void {
    this.runtimes.delete(sessionId);
  }

  wake(sessionId: string): void {
    this.startBackgroundDelivery(sessionId, this.getOrCreate(sessionId));
  }

  async reconfigureAfterSettingsUpdate(): Promise<void> {
    if (this.providerReconfiguration) {
      await this.providerReconfiguration;
      return;
    }
    const operation = this.performSettingsReconfiguration();
    this.providerReconfiguration = operation;
    try {
      await operation;
    } finally {
      this.providerReconfiguration = undefined;
    }
  }

  private async performSettingsReconfiguration(): Promise<void> {
    await this.resetRuntimeGeneration(new DOMException("Server settings changed", "AbortError"));
  }

  private async resetRuntimeGeneration(reason: DOMException): Promise<void> {
    for (const controllers of this.sessionControllers.values()) {
      for (const controller of controllers) controller.abort(reason);
    }
    for (const worker of this.workerControllers.values()) worker.controller.abort(reason);
    await this.waitForActiveWorkToSettle();
    this.sessionControllers.clear();
    this.workerControllers.clear();
    this.backgroundDeliveries.clear();
    this.lifecycleWaiters.clear();
    this.runtimes.clear();
    this.providerRuntime = undefined;
  }

  private waitForActiveWorkToSettle(): Promise<void> {
    if (
      this.sessionControllers.size === 0 &&
      this.workerControllers.size === 0 &&
      this.backgroundDeliveries.size === 0
    ) {
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.lifecycleWaiters.add(resolve));
  }

  private notifyLifecycleWaiters(): void {
    if (
      this.sessionControllers.size !== 0 ||
      this.workerControllers.size !== 0 ||
      this.backgroundDeliveries.size !== 0
    ) {
      return;
    }
    const waiters = [...this.lifecycleWaiters];
    this.lifecycleWaiters.clear();
    for (const resolve of waiters) resolve();
  }

  trackSession(sessionId: string, controller: AbortController): void {
    let controllers = this.sessionControllers.get(sessionId);
    if (!controllers) {
      controllers = new Set();
      this.sessionControllers.set(sessionId, controllers);
    }
    controllers.add(controller);
  }

  clearSession(sessionId: string, controller: AbortController): void {
    const controllers = this.sessionControllers.get(sessionId);
    if (controllers) {
      controllers.delete(controller);
      if (controllers.size === 0) {
        this.sessionControllers.delete(sessionId);
      }
    }
    this.notifyLifecycleWaiters();
  }

  trackWorker(taskId: string, parentSessionId: string, controller: AbortController): void {
    this.workerControllers.set(taskId, { controller, parentSessionId });
  }

  onWorkerSettled(taskId: string): void {
    this.workerControllers.delete(taskId);
    this.notifyLifecycleWaiters();
  }

  isSessionAvailable(sessionId: string): boolean {
    return !this.deletedSessions.has(sessionId);
  }

  markSessionCreated(sessionId: string): void {
    this.deletedSessions.delete(sessionId);
  }

  private static readonly MAX_DELETED_SESSIONS = 5000;

  prepareSessionDeletion(sessionId: string): void {
    // FIFO eviction: `Set` preserves insertion order, so `keys().next().value`
    // returns the oldest entry. This caps the set's memory under steady-state
    // server churn while never evicting a freshly-deleted session mid-flight.
    if (this.deletedSessions.size >= SessionManager.MAX_DELETED_SESSIONS) {
      const oldest = this.deletedSessions.keys().next().value;
      if (oldest !== undefined) {
        this.deletedSessions.delete(oldest);
      }
    }
    this.deletedSessions.add(sessionId);
    const controllers = this.sessionControllers.get(sessionId);
    if (controllers) {
      for (const controller of controllers) {
        controller.abort();
      }
    }
    this.unload(sessionId);
    for (const worker of this.workerControllers.values()) {
      if (worker.parentSessionId !== sessionId) continue;
      worker.controller.abort();
    }
    this.notifyLifecycleWaiters();
  }

  onWorkerCompleted(delegatingSessionId: string, pending: PendingMessage): void {
    emitAgentEvent("worker:completed", {
      sessionId: delegatingSessionId,
      taskId: pending.taskId,
      agentName: pending.agentName,
      status: pending.status,
      summary: pending.summary,
    });

    const runtime = this.providerReconfiguration
      ? undefined
      : this.runtimes.get(delegatingSessionId);
    if (runtime) {
      this.startBackgroundDelivery(delegatingSessionId, runtime);
    }
    // Not loaded: the pending message stays durable on disk until the session is loaded.
  }

  cancelWorker(taskId: string): boolean {
    const worker = this.workerControllers.get(taskId);
    if (!worker) return false;
    worker.controller.abort();
    return true;
  }

  private startBackgroundDelivery(sessionId: string, runtime: SessionRuntime): void {
    const delivery = runtime
      .deliver()
      .catch((err) => {
        logger.error("Wake run failed", { sessionId, ...describeError(err) });
      })
      .finally(() => {
        this.backgroundDeliveries.delete(delivery);
        this.notifyLifecycleWaiters();
      });
    this.backgroundDeliveries.add(delivery);
  }

  metrics(): {
    agentExecutions: { active: number; limit: number; queued: number; queueLimit: number };
    loadedSessions: number;
    activeWorkers: number;
  } {
    return {
      agentExecutions: this.executionLimiter?.snapshot() ?? {
        active: 0,
        limit: getConfig().MAX_CONCURRENT_AGENTS,
        queued: 0,
        queueLimit: Math.max(10, getConfig().MAX_CONCURRENT_AGENTS * 10),
      },
      loadedSessions: this.runtimes.size,
      activeWorkers: this.workerControllers.size,
    };
  }

  private buildToolRegistry(
    sessionId: string,
    llmClient: ReturnType<typeof createVercelAILLMClient>,
    capabilityRegistry: CapabilityRegistry,
    executionLimiter: ExecutionLimiter,
  ): ToolRegistry {
    const config = getConfig();
    const serverConfig = parseServerConfig();
    const registry = new ToolRegistry();
    registry.register(createReadFileTool(config.ROOT));
    registry.register(createWriteFileTool(config.ROOT));
    registry.register(createEditFileTool(config.ROOT));
    registry.register(createListDirectoryTool(config.ROOT));
    registry.register(globTool);
    registry.register(grepTool);
    if (serverConfig.enableRunCommand) registry.register(runCommandTool);
    if (serverConfig.enableWebFetch) registry.register(webFetchTool);
    registry.register(
      createDelegateTool({
        sessionsDir: config.SESSIONS_DIR,
        db: this.db,
        sessionId,
        resolveConfig: resolveAgentConfig,
        toolRegistry: registry,
        llmClient,
        capabilityRegistry,
        executionLimiter,
        onWorkerSpawned: (taskId, workerSessionId, task, controller) => {
          this.trackWorker(taskId, sessionId, controller);
          emitAgentEvent("worker:spawned", { sessionId, taskId, workerSessionId, task });
        },
        onWorkerCompleted: (delegatingSessionId, pending) =>
          this.onWorkerCompleted(delegatingSessionId, pending),
        onWorkerSettled: (taskId) => this.onWorkerSettled(taskId),
        isSessionAvailable: (candidateSessionId) => this.isSessionAvailable(candidateSessionId),
        onBackgroundError: (error) => {
          logger.error("Background worker persistence failed", {
            sessionId,
            ...describeError(error),
          });
        },
        onWorkerTool: (workerSessionId, event) => {
          const tool =
            event.type === "tool:called"
              ? { type: "called" as const, toolName: event.toolName, args: event.args }
              : { type: "completed" as const, toolName: event.toolName, result: event.result };
          emitAgentEvent("agent:tool", {
            sessionId,
            agentName: workerSessionId,
            tool,
          });
          if (event.type === "tool:called") {
            this.audit({
              actorType: "agent",
              actorId: workerSessionId,
              action: `tool.exec.${mapToolAction(event.toolName)}`,
              resourceType: "tool",
              resourceId: event.toolName,
              payload: {
                sessionId,
                workerSessionId,
                args: isRecord(event.args) ? event.args : { raw: event.args },
              },
            });
          }
        },
      }),
    );
    registry.register(createReadSessionTool(config.SESSIONS_DIR));
    return registry;
  }

  private getExecutionLimiter(limit: number): ExecutionLimiter {
    if (!this.executionLimiter) {
      this.executionLimiter = new ExecutionLimiter(limit);
    } else {
      this.executionLimiter.setLimit(limit);
    }
    return this.executionLimiter;
  }

  private handleRuntimeEvent(event: SessionRuntimeEvent): void {
    switch (event.type) {
      case "agent:started":
        emitAgentEvent("agent:started", event);
        break;
      case "agent:completed":
        emitAgentEvent("agent:completed", event);
        break;
      case "agent:error":
        emitAgentEvent("agent:error", event);
        break;
      case "agent:tool":
        emitAgentEvent("agent:tool", event);
        if (event.tool.type === "called") {
          this.audit({
            actorType: "agent",
            actorId: event.agentName,
            action: `tool.exec.${mapToolAction(event.tool.toolName)}`,
            resourceType: "tool",
            resourceId: event.tool.toolName,
            payload: {
              sessionId: event.sessionId,
              runId: event.runId,
              ...(event.requestId ? { requestId: event.requestId } : {}),
              args: isRecord(event.tool.args) ? event.tool.args : { raw: event.tool.args },
            },
          });
        }
        break;
      case "session:updated":
        emitAgentEvent("session:updated", event.session);
        break;
    }
  }
}

function mapToolAction(toolName: string): string {
  switch (toolName) {
    case "runCommand":
      return "shell";
    case "writeFile":
    case "editFile":
      return "file_write";
    case "readFile":
    case "readSession":
      return "file_read";
    case "webFetch":
      return "network";
    case "listDirectory":
    case "glob":
      return "file_list";
    case "grep":
      return "search";
    case "delegate":
      return "delegate";
    default:
      return toolName;
  }
}

export const sessionManager = new SessionManager();
