import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { LLMClient } from "../llm/client.js";
import type { PendingMessage } from "../persistence/session.js";
import { SessionStore } from "../persistence/session.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { Tool, ToolRegistry } from "../tool/types.js";
import { type AgentConfig, type TaskId, TaskIdSchema } from "./types.js";
import { Worker } from "./worker.js";

export interface DelegationDeps {
  sessionsDir: string;
  sessionId: string;
  resolveConfig: (agentName: string | undefined) => AgentConfig;
  toolRegistry: ToolRegistry;
  llmClient: LLMClient;
  capabilityRegistry: CapabilityRegistry;
  executionLimiter?: ExecutionLimiter;
  onWorkerSpawned?: (
    taskId: TaskId,
    workerSessionId: string,
    task: string,
    abort: AbortController,
  ) => void;
  onWorkerCompleted?: (delegatingSessionId: string, pending: PendingMessage) => void;
  onWorkerSettled?: (taskId: TaskId) => void;
  onBackgroundError?: (error: unknown) => void;
  isSessionAvailable?: (sessionId: string) => boolean;
  onWorkerTool?: (
    workerSessionId: string,
    event:
      | { type: "tool:called"; toolName: string; args?: Record<string, unknown> }
      | { type: "tool:completed"; toolName: string; result?: string },
  ) => void;
}

export function createDelegateTool(deps: DelegationDeps): Tool {
  const reportBackgroundError = (error: unknown) => {
    try {
      deps.onBackgroundError?.(error);
    } catch (reportingError) {
      console.error("[delegation] Background error observer failed", reportingError);
    }
  };

  const parameters = z.object({
    task: z.string().describe("The task description to delegate to a worker agent"),
    model: z
      .string()
      .optional()
      .describe(
        "The model to use for the worker agent. Omit this to inherit the delegating agent's own model, which is guaranteed to be supported.",
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
        ...delegatingAgent,
        name: `worker-${taskId}`,
        model: model || delegatingAgent.model,
        tools: delegatingAgent.tools.filter((toolName) => toolName !== "delegate"),
      };

      const createdAt = new Date().toISOString();
      await store.save({
        sessionId,
        taskId,
        agentName: workerConfig.name,
        prompt: task,
        messages: [],
        mailbox: [],
        createdAt,
      });

      const controller = new AbortController();
      const worker = new Worker(
        taskId,
        workerConfig,
        deps.toolRegistry,
        deps.llmClient,
        deps.capabilityRegistry,
        controller.signal,
        (e) => {
          if (e.type === "step") {
            // Progressively persist the worker transcript so the drawer can
            // show work-in-progress instead of waiting for completion.
            void store
              .save({
                sessionId,
                taskId,
                agentName: workerConfig.name,
                prompt: task,
                messages: e.messages.map((m) => ({
                  ...m,
                  createdAt: m.createdAt ?? new Date().toISOString(),
                })),
                createdAt,
                result: { status: "running", summary: "" },
              })
              .catch(reportBackgroundError);
            return;
          }
          deps.onWorkerTool?.(sessionId, e);
        },
        deps.executionLimiter,
      );

      deps.onWorkerSpawned?.(taskId, sessionId, task, controller);

      const finishWorker = async () => {
        const result = await worker.run(task);
        const existing = await store.load(sessionId);
        await store.save({
          sessionId,
          taskId,
          agentName: workerConfig.name,
          prompt: task,
          messages: result.messages.map((entry) => ({
            ...entry,
            createdAt: entry.createdAt ?? new Date().toISOString(),
          })),
          mailbox: existing?.mailbox ?? [],
          result: { status: result.status, summary: result.summary },
          createdAt: existing?.createdAt ?? createdAt,
          completedAt: new Date().toISOString(),
        });

        if (deps.isSessionAvailable && !deps.isSessionAvailable(deps.sessionId)) return;
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
        if (deps.isSessionAvailable && !deps.isSessionAvailable(deps.sessionId)) {
          await store.acknowledgeMailbox(deps.sessionId, [pending.taskId]);
          return;
        }
        deps.onWorkerCompleted?.(deps.sessionId, pending);
      };

      void finishWorker()
        .catch(reportBackgroundError)
        .finally(() => {
          try {
            deps.onWorkerSettled?.(taskId);
          } catch (error) {
            reportBackgroundError(error);
          }
        });

      return JSON.stringify({ taskId, sessionId, status: "delegated" });
    },
  };
}

export function createReadSessionTool(sessionsDir: string): Tool {
  const parameters = z.object({
    taskId: TaskIdSchema.describe("The taskId of the worker session to read"),
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
