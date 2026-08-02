import path from "node:path";
import {
  CapabilityRegistry,
  SessionRuntime,
  ToolRegistry,
  createVercelAILLMClient,
  getConfig,
  loadAgentConfig,
  createReadFileTool,
  createWriteFileTool,
  createEditFileTool,
  createListDirectoryTool,
  globTool,
  grepTool,
  runCommandTool,
  webFetchTool,
  createDelegateTool,
  createReadSessionTool,
} from "@agent-harness/core";
import type {
  AgentConfig,
  PendingMessage,
  SessionRuntimeEvent,
} from "@agent-harness/core";
import { emitAgentEvent } from "./ws/events.js";

export function resolveAgentConfig(agentName: string | undefined): AgentConfig {
  const config = getConfig();
  const name = agentName || "orchestrator";
  try {
    const agentConfig = loadAgentConfig(path.join(config.AGENTS_DIR, `${name}.md`));
    if (agentConfig.model === "DEFAULT") agentConfig.model = config.DEFAULT_MODEL;
    return agentConfig;
  } catch {
    try {
      const orchestratorConfig = loadAgentConfig(
        path.join(config.AGENTS_DIR, "orchestrator.md")
      );
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
  private workerControllers = new Map<string, AbortController>();

  getOrCreate(sessionId: string): SessionRuntime {
    let runtime = this.runtimes.get(sessionId);
    if (!runtime) {
      const config = getConfig();
      const llmClient = createVercelAILLMClient(config);
      const capabilityRegistry = new CapabilityRegistry({
        workspaceRoot: config.ROOT,
        baseUrl: config.PROVIDER_ENDPOINT,
      });
      runtime = new SessionRuntime({
        sessionId,
        sessionsDir: config.SESSIONS_DIR,
        resolveConfig: resolveAgentConfig,
        toolRegistry: this.buildToolRegistry(sessionId, llmClient, capabilityRegistry),
        llmClient,
        capabilityRegistry,
        onEvent: (event) => this.handleRuntimeEvent(event),
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

  onWorkerCompleted(delegatingSessionId: string, pending: PendingMessage): void {
    this.workerControllers.delete(pending.taskId);
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
        console.error("[session-manager] Wake run failed:", err);
      });
    }
    // Not loaded: the pending message stays durable on disk until the session is loaded.
  }

  cancelWorker(taskId: string): boolean {
    const controller = this.workerControllers.get(taskId);
    if (!controller) return false;
    controller.abort();
    this.workerControllers.delete(taskId);
    return true;
  }

  private buildToolRegistry(
    sessionId: string,
    llmClient: ReturnType<typeof createVercelAILLMClient>,
    capabilityRegistry: CapabilityRegistry
  ): ToolRegistry {
    const config = getConfig();
    const registry = new ToolRegistry();
    registry.register(createReadFileTool(config.ROOT));
    registry.register(createWriteFileTool(config.ROOT));
    registry.register(createEditFileTool(config.ROOT));
    registry.register(createListDirectoryTool(config.ROOT));
    registry.register(globTool);
    registry.register(grepTool);
    registry.register(runCommandTool);
    registry.register(webFetchTool);
    registry.register(
      createDelegateTool({
        sessionsDir: config.SESSIONS_DIR,
        sessionId,
        resolveConfig: resolveAgentConfig,
        toolRegistry: registry,
        llmClient,
        capabilityRegistry,
        onWorkerSpawned: (taskId, workerSessionId, task, controller) => {
          this.workerControllers.set(taskId, controller);
          emitAgentEvent("worker:spawned", { sessionId, taskId, workerSessionId, task });
        },
        onWorkerCompleted: (delegatingSessionId, pending) =>
          this.onWorkerCompleted(delegatingSessionId, pending),
      })
    );
    registry.register(createReadSessionTool(config.SESSIONS_DIR));
    return registry;
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
