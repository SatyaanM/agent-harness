import path from "node:path";
import type { AgentConfig, PendingMessage, SessionRuntimeEvent } from "@agent-harness/core";
import {
  CapabilityRegistry,
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
  loadAgentConfig,
  runCommandTool,
  SessionRuntime,
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

  getOrCreate(sessionId: string): SessionRuntime {
    if (!this.isSessionAvailable(sessionId)) {
      throw new Error(`Session ${sessionId} was deleted`);
    }
    const config = getConfig();
    const executionLimiter = this.getExecutionLimiter(config.MAX_CONCURRENT_AGENTS);
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      const llmClient = createVercelAILLMClient(config);
      const capabilityRegistry = new CapabilityRegistry({
        workspaceRoot: config.ROOT,
        baseUrl: config.PROVIDER_ENDPOINT,
      });
      runtime = new SessionRuntime({
        sessionId,
        sessionsDir: config.SESSIONS_DIR,
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
  }

  trackWorker(taskId: string, parentSessionId: string, controller: AbortController): void {
    this.workerControllers.set(taskId, { controller, parentSessionId });
  }

  onWorkerSettled(taskId: string): void {
    this.workerControllers.delete(taskId);
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
      this.sessionControllers.delete(sessionId);
    }
    this.unload(sessionId);
    for (const [taskId, worker] of this.workerControllers) {
      if (worker.parentSessionId !== sessionId) continue;
      worker.controller.abort();
      this.workerControllers.delete(taskId);
    }
  }

  onWorkerCompleted(delegatingSessionId: string, pending: PendingMessage): void {
    emitAgentEvent("worker:completed", {
      sessionId: delegatingSessionId,
      taskId: pending.taskId,
      agentName: pending.agentName,
      status: pending.status,
      summary: pending.summary,
    });

    const runtime = this.runtimes.get(delegatingSessionId);
    if (runtime) {
      // Loaded session: wake it to process the delivered completion.
      runtime.deliver().catch((err) => {
        logger.error("Wake run failed", { sessionId: delegatingSessionId, ...describeError(err) });
      });
    }
    // Not loaded: the pending message stays durable on disk until the session is loaded.
  }

  cancelWorker(taskId: string): boolean {
    const worker = this.workerControllers.get(taskId);
    if (!worker) return false;
    worker.controller.abort();
    this.workerControllers.delete(taskId);
    return true;
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
        break;
      case "session:updated":
        emitAgentEvent("session:updated", event.session);
        break;
    }
  }
}

export const sessionManager = new SessionManager();
