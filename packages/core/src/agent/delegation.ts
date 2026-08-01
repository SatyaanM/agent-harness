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
  config: AgentConfig;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  capabilityRegistry: CapabilityRegistry;
}

export function createDelegateTool(deps: DelegationDeps): Tool {
  const parameters = z.object({
    task: z.string().describe("The task description to delegate to a worker agent"),
    model: z.string().describe("The model to use for the worker agent"),
  });

  return {
    name: "delegate",
    description:
      "Spawn a worker agent to handle a task in the background. Returns a taskId immediately without blocking. When the worker completes, the system delivers the result to this session automatically.",
    parameters,
    async execute({ task, model }: { task: string; model: string }) {
      const taskId: TaskId = uuidv4();
      const sessionId = `worker-${taskId}`;

      const workerConfig: AgentConfig = {
        name: `worker-${taskId}`,
        model,
        tools: deps.config.tools,
        maxSteps: deps.config.maxSteps,
        instructions: deps.config.instructions,
      };

      const store = new SessionStore(deps.sessionsDir);
      await store.save({
        sessionId,
        taskId,
        agentName: workerConfig.name,
        prompt: task,
        messages: [],
        mailbox: [],
        createdAt: new Date().toISOString(),
      });

      const worker = new Worker(
        taskId,
        workerConfig,
        deps.toolRegistry,
        deps.llmClient,
        deps.capabilityRegistry,
        deps.sessionId,
        messageBus,
      );

      void worker.run(task).then(async (result) => {
        const delegating = await store.load(deps.sessionId);
        if (!delegating) return;
        const pending: PendingMessage = {
          taskId,
          from: sessionId,
          agentName: workerConfig.name,
          status: result.status === "done" ? "done" : "error",
          summary: result.summary,
          receivedAt: new Date().toISOString(),
        };
        delegating.mailbox = [...(delegating.mailbox ?? []), pending];
        await store.save(delegating);
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
