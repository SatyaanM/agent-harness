import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { AgentConfig, TaskId } from "./types.js";
import { Worker } from "./worker.js";
import type { Tool, ToolRegistry } from "../tool/types.js";
import type { LLMClient } from "../llm/client.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import { SessionStore } from "../persistence/session.js";
import type { PendingMessage } from "../persistence/session.js";
import { messageBus } from "../collaboration/message-bus.js";

export interface DelegationDeps {
  sessionsDir: string;
  sessionId: string;
  resolveConfig: (agentName: string | undefined) => AgentConfig;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  capabilityRegistry: CapabilityRegistry;
  onWorkerSpawned?: (
    taskId: TaskId,
    workerSessionId: string,
    task: string,
    abort: AbortController
  ) => void;
  onWorkerCompleted?: (delegatingSessionId: string, pending: PendingMessage) => void;
}

export function createDelegateTool(deps: DelegationDeps): Tool {
  const parameters = z.object({
    task: z.string().describe("The task description to delegate to a worker agent"),
    model: z
      .string()
      .optional()
      .describe(
        "The model to use for the worker agent. Omit this to inherit the delegating agent's own model, which is guaranteed to be supported."
      ),
  });

  return {
    name: "delegate",
    description:
      "Spawn a worker agent to handle a task in the background. Returns a taskId immediately without blocking. When the worker completes, the system delivers the result to this session automatically. Omit the model argument to inherit your own model.",
    parameters,
    async execute({ task, model }: { task: string; model?: string }) {
      const taskId: TaskId = uuidv4();
      const sessionId = `worker-${taskId}`;

      const store = new SessionStore(deps.sessionsDir);
      const delegating = await store.load(deps.sessionId);
      const delegatingAgent = deps.resolveConfig(delegating?.agentName ?? "orchestrator");
      const workerConfig: AgentConfig = {
        name: `worker-${taskId}`,
        model: model || delegatingAgent.model,
        tools: delegatingAgent.tools,
        maxSteps: delegatingAgent.maxSteps,
        instructions: delegatingAgent.instructions,
      };

      await store.save({
        sessionId,
        taskId,
        agentName: workerConfig.name,
        prompt: task,
        messages: [],
        mailbox: [],
        createdAt: new Date().toISOString(),
      });

      const controller = new AbortController();
      const worker = new Worker(
        taskId,
        workerConfig,
        deps.toolRegistry,
        deps.llmClient,
        deps.capabilityRegistry,
        deps.sessionId,
        messageBus,
        controller.signal,
      );

      deps.onWorkerSpawned?.(taskId, sessionId, task, controller);

      void worker.run(task).then(async (result) => {
        const existing = await store.load(sessionId);
        await store.save({
          sessionId,
          taskId,
          agentName: workerConfig.name,
          prompt: task,
          messages: result.messages,
          mailbox: existing?.mailbox ?? [],
          result: { status: result.status, summary: result.summary },
          createdAt: existing?.createdAt ?? new Date().toISOString(),
          completedAt: new Date().toISOString(),
        });

        const delegating = await store.load(deps.sessionId);
        if (!delegating) return;
        const pending: PendingMessage = {
          taskId,
          from: sessionId,
          agentName: workerConfig.name,
          status:
            result.status === "done"
              ? "done"
              : result.status === "cancelled"
                ? "cancelled"
                : "error",
          summary: result.summary,
          receivedAt: new Date().toISOString(),
        };
        await store.appendMailbox(deps.sessionId, pending);
        deps.onWorkerCompleted?.(deps.sessionId, pending);
      });

      return JSON.stringify({ taskId, sessionId, status: "delegated" });
    },
  };
}

export function createReadSessionTool(sessionsDir: string): Tool {
  const parameters = z.object({
    taskId: z.string().describe("The taskId of the worker session to read"),
  });

  return {
    name: "readSession",
    description: "Load and return the full session transcript for a delegated task.",
    parameters,
    async execute({ taskId }: { taskId: string }) {
      const store = new SessionStore(sessionsDir);
      const session = await store.load(`worker-${taskId}`);
      if (!session) {
        return JSON.stringify({ error: `Session not found for taskId: ${taskId}` });
      }
      return JSON.stringify(session);
    },
  };
}
