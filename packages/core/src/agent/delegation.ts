import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { CapabilityRegistry } from "../capability/registry.js";
import { describeError } from "../contracts/errors.js";
import { createLogger } from "../contracts/logging.js";
import { MAX_WORKERS_PER_SESSION } from "../contracts/session.js";
import { getTracer, W3CTraceContext } from "../contracts/tracing.js";

import type { LLMClient } from "../llm/client.js";
import type { PendingMessage } from "../persistence/session.js";
import { SessionStore } from "../persistence/session.js";
import { MailboxRepository } from "../persistence/sqlite/mailbox-repo.js";
import { SessionRepository } from "../persistence/sqlite/session-repo.js";
import { TaskRepository } from "../persistence/sqlite/task-repo.js";
import type { ISqliteDatabase } from "../persistence/sqlite/types.js";
import type { ExecutionLimiter } from "../runtime/execution-limiter.js";
import type { Tool, ToolRegistry } from "../tool/types.js";
import { type AgentConfig, type TaskId, TaskIdSchema } from "./types.js";
import { Worker } from "./worker.js";

export interface DelegationDeps {
  sessionsDir: string;
  db?: ISqliteDatabase;
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
  const logger = createLogger("core.delegation").child({ sessionId: deps.sessionId });
  const reportBackgroundError = (error: unknown) => {
    try {
      deps.onBackgroundError?.(error);
    } catch (reportingError) {
      logger.error("Background error observer failed", { ...describeError(reportingError) });
    }
  };
  const commitTerminalSettlement = (commit: () => void) => {
    const maxAttempts = 3;
    let lastError: unknown;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      try {
        commit();
        return;
      } catch (error) {
        lastError = error;
      }
    }
    throw lastError;
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
        capabilities: delegatingAgent.capabilities
          ? { ...delegatingAgent.capabilities }
          : undefined,
      };

      if (deps.db) {
        const taskRepo = new TaskRepository(deps.db);
        const sessionRepo = new SessionRepository(deps.db);
        deps.db.immediateTransaction(() => {
          const activeDelegations = taskRepo.countActiveByParent(deps.sessionId);
          if (activeDelegations >= MAX_WORKERS_PER_SESSION) {
            throw new Error(
              `Cannot delegate: active delegation limit of ${MAX_WORKERS_PER_SESSION} reached for session ${deps.sessionId}`,
            );
          }
          const existingWorkerSession = sessionRepo.get(sessionId);
          if (!existingWorkerSession) {
            sessionRepo.create({
              id: sessionId,
              agentName: workerConfig.name,
              prompt: task,
              createdAt: Date.now(),
            });
          }
          taskRepo.create({
            taskId,
            parentSessionId: deps.sessionId,
            workerSessionId: sessionId,
            description: task,
            status: "running",
            createdAt: Date.now(),
          });
        })();
      }

      const createdAt = new Date().toISOString();
      try {
        await store.save({
          sessionId,
          taskId,
          agentName: workerConfig.name,
          prompt: task,
          messages: [],
          mailbox: [],
          createdAt,
        });
      } catch (persistenceError) {
        if (deps.db) {
          const taskRepo = new TaskRepository(deps.db);
          const sessionRepo = new SessionRepository(deps.db);
          deps.db.immediateTransaction(() => {
            taskRepo.delete(taskId);
            sessionRepo.delete(sessionId);
          })();
        }
        throw persistenceError;
      }

      let controller: AbortController;
      let worker: Worker;
      try {
        controller = new AbortController();
        worker = new Worker(
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
            if (e.type === "tool:called" || e.type === "tool:completed") {
              deps.onWorkerTool?.(sessionId, e);
            }
          },
          deps.executionLimiter,
        );

        deps.onWorkerSpawned?.(taskId, sessionId, task, controller);
      } catch (spawnError) {
        if (deps.db) {
          try {
            const taskRepo = new TaskRepository(deps.db);
            taskRepo.update(taskId, {
              status: "failed",
              completedAt: Date.now(),
              errorMessage: describeError(spawnError).message,
            });
          } catch {
            // best-effort cleanup
          }
        }
        throw spawnError;
      }

      const tracer = getTracer();
      const currentCtx = tracer.currentContext();
      const traceCarrier: Record<string, string> = {};
      if (currentCtx) {
        W3CTraceContext.inject(currentCtx, traceCarrier);
      }

      const finishWorker = () =>
        finishWorkerRun({
          worker,
          task,
          taskId,
          sessionId,
          workerConfig,
          createdAt,
          traceCarrier,
          store,
          deps,
          reportBackgroundError,
          commitTerminalSettlement,
        });

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

type WorkerRunResult = Awaited<ReturnType<Worker["run"]>>;

interface FinishWorkerOptions {
  worker: Worker;
  task: string;
  taskId: TaskId;
  sessionId: string;
  workerConfig: AgentConfig;
  createdAt: string;
  traceCarrier: Record<string, string>;
  store: SessionStore;
  deps: DelegationDeps;
  reportBackgroundError: (error: unknown) => void;
  commitTerminalSettlement: (commit: () => void) => void;
}

async function finishWorkerRun(options: FinishWorkerOptions): Promise<void> {
  let result: WorkerRunResult;
  try {
    result = await options.worker.run(options.task, options.traceCarrier);
    await persistCompletedWorker(options, result);
  } catch (workerError) {
    const pending = createWorkerFailureMessage(options, workerError);
    recordWorkerFailure(options, pending, describeError(workerError).message);
    options.deps.onWorkerCompleted?.(options.deps.sessionId, pending);
    throw workerError;
  }

  const pending = createWorkerCompletionMessage(options, result);
  settleCompletedWorker(options, result, pending);
  await appendLegacyCompletion(options, pending);
  await notifyWorkerCompletion(options, pending);
}

async function persistCompletedWorker(
  options: FinishWorkerOptions,
  result: WorkerRunResult,
): Promise<void> {
  const existing = await options.store.load(options.sessionId);
  await options.store.save({
    sessionId: options.sessionId,
    taskId: options.taskId,
    agentName: options.workerConfig.name,
    prompt: options.task,
    messages: result.messages.map((entry) => ({
      ...entry,
      createdAt: entry.createdAt ?? new Date().toISOString(),
    })),
    mailbox: existing?.mailbox ?? [],
    result: { status: result.status, summary: result.summary },
    createdAt: existing?.createdAt ?? options.createdAt,
    completedAt: new Date().toISOString(),
  });
}

function createWorkerFailureMessage(options: FinishWorkerOptions, error: unknown): PendingMessage {
  const errorMsg = describeError(error).message;
  return {
    taskId: options.taskId,
    from: options.sessionId,
    agentName: options.workerConfig.name,
    status: "error",
    summary: `Worker failed: ${errorMsg}`,
    receivedAt: new Date().toISOString(),
  };
}

function recordWorkerFailure(
  options: FinishWorkerOptions,
  pending: PendingMessage,
  errorMsg: string,
): void {
  if (!options.deps.db) return;
  try {
    const taskRepo = new TaskRepository(options.deps.db);
    const mailboxRepo = new MailboxRepository(options.deps.db);
    options.deps.db.immediateTransaction(() => {
      taskRepo.update(options.taskId, {
        status: "failed",
        errorMessage: errorMsg,
        completedAt: Date.now(),
      });
      mailboxRepo.enqueue({
        parentSessionId: options.deps.sessionId,
        taskId: options.taskId,
        payload: pending,
      });
    })();
  } catch {
    // best-effort error record
  }
}

function createWorkerCompletionMessage(
  options: FinishWorkerOptions,
  result: WorkerRunResult,
): PendingMessage {
  return {
    taskId: options.taskId,
    from: options.sessionId,
    agentName: options.workerConfig.name,
    status: workerCompletionStatus(result),
    summary: result.summary,
    receivedAt: new Date().toISOString(),
  };
}

function workerCompletionStatus(result: WorkerRunResult): PendingMessage["status"] {
  if (result.status === "done") return "done";
  return result.status === "cancelled" ? "cancelled" : "error";
}

function settleCompletedWorker(
  options: FinishWorkerOptions,
  result: WorkerRunResult,
  pending: PendingMessage,
): void {
  if (!options.deps.db) return;

  const db = options.deps.db;
  const taskRepo = new TaskRepository(db);
  const mailboxRepo = new MailboxRepository(db);
  options.commitTerminalSettlement(() => {
    db.immediateTransaction(() => {
      taskRepo.update(options.taskId, {
        status: workerTaskStatus(result),
        errorMessage: workerTaskError(result),
        completedAt: Date.now(),
      });
      mailboxRepo.enqueue({
        parentSessionId: options.deps.sessionId,
        taskId: options.taskId,
        payload: pending,
      });
    })();
  });
}

function workerTaskStatus(result: WorkerRunResult): "completed" | "cancelled" | "failed" {
  if (result.status === "done") return "completed";
  return result.status === "cancelled" ? "cancelled" : "failed";
}

function workerTaskError(result: WorkerRunResult): string | null {
  return result.status === "done" || result.status === "cancelled" ? null : result.summary;
}

async function appendLegacyCompletion(
  options: FinishWorkerOptions,
  pending: PendingMessage,
): Promise<void> {
  try {
    await options.store.appendMailbox(options.deps.sessionId, pending);
  } catch (error) {
    options.reportBackgroundError(error);
  }
}

async function notifyWorkerCompletion(
  options: FinishWorkerOptions,
  pending: PendingMessage,
): Promise<void> {
  if (options.deps.isSessionAvailable?.(options.deps.sessionId) === false) {
    try {
      await options.store.acknowledgeMailbox(options.deps.sessionId, [pending.taskId]);
    } catch (error) {
      options.reportBackgroundError(error);
    }
    return;
  }
  options.deps.onWorkerCompleted?.(options.deps.sessionId, pending);
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
