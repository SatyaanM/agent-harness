import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../capability/registry.js";
import { messageBus } from "../collaboration/message-bus.js";
import type { LLMChatParams, LLMClient } from "../llm/client.js";
import { createSessionData, type PendingMessage, SessionStore } from "../persistence/session.js";
import {
  createDatabaseConnection,
  MailboxRepository,
  SessionRepository,
  SqliteMigrator,
  TaskRepository,
} from "../persistence/sqlite/index.js";
import { ToolRegistry } from "../tool/registry.js";
import { createDelegateTool } from "./delegation.js";
import type { AgentConfig } from "./types.js";

const tempDirs: string[] = [];

function createPermissiveCapabilityRegistry(workspaceRoot: string): CapabilityRegistry {
  const registry = new CapabilityRegistry({ workspaceRoot });
  vi.spyOn(registry, "lookup").mockResolvedValue({
    chat: true,
    tools: true,
    vision: true,
    streaming: false,
    structuredOutputs: false,
    promptCaching: false,
    reasoning: false,
    maxTokens: 0,
  });
  return registry;
}

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("delegation controls", () => {
  it("prevents workers from recursively using the parent-bound delegate tool", async () => {
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({
        sessionId: "parent-session",
        taskId: "parent-task",
        prompt: "parent",
        agentName: "orchestrator",
        messages: [],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    const parentConfig: AgentConfig = {
      name: "orchestrator",
      model: "fake-model",
      tools: ["delegate", "safe"],
      maxSteps: 2,
      instructions: "Test",
      capabilities: { vision: false, promptCaching: true },
    };
    const registry = new ToolRegistry();
    for (const name of parentConfig.tools) {
      registry.register({
        name,
        description: name,
        parameters: z.object({}),
        async execute() {
          return "unused";
        },
      });
    }
    const observed: LLMChatParams[] = [];
    const llmClient: LLMClient = {
      async chat(params) {
        observed.push({ ...params, messages: [...params.messages] });
        return {
          finishReason: "stop",
          message: { role: "assistant", content: "worker complete" },
        };
      },
    };
    let resolveCompletion: ((pending: PendingMessage) => void) | undefined;
    const completion = new Promise<PendingMessage>((resolve) => {
      resolveCompletion = resolve;
    });
    const capabilityRegistry = new CapabilityRegistry({ workspaceRoot: sessionsDir });
    const lookup = vi.spyOn(capabilityRegistry, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: false,
      streaming: false,
      structuredOutputs: false,
      promptCaching: true,
      reasoning: false,
      maxTokens: 0,
    });
    const delegate = createDelegateTool({
      sessionsDir,
      sessionId: "parent-session",
      resolveConfig: () => parentConfig,
      toolRegistry: registry,
      llmClient,
      capabilityRegistry,
      onWorkerCompleted: (_sessionId, pending) => resolveCompletion?.(pending),
    });

    await delegate.execute({ task: "child task" });
    await expect(completion).resolves.toEqual(
      expect.objectContaining({ status: "done", summary: "worker complete" }),
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]?.tools?.map((tool) => tool.name)).toEqual(["safe"]);
    expect(lookup).toHaveBeenCalledWith(
      "default",
      "fake-model",
      "vercel-ai",
      expect.objectContaining({
        tools: ["safe"],
        capabilities: { vision: false, promptCaching: true },
      }),
    );
    await expect(store.peekMailbox("parent-session")).resolves.toEqual([
      expect.objectContaining({ status: "done", summary: "worker complete" }),
    ]);
    expect(messageBus.readInbox("parent-session")).toEqual([]);
  });

  it("always settles a worker and skips delivery after its parent is deleted", async () => {
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({
        sessionId: "deleted-parent",
        taskId: "parent-task",
        prompt: "parent",
        agentName: "orchestrator",
        messages: [],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const settled = vi.fn();
    let parentAvailable = true;
    const delegate = createDelegateTool({
      sessionsDir,
      sessionId: "deleted-parent",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          await gate;
          return {
            finishReason: "stop",
            message: { role: "assistant", content: "done" },
          };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      isSessionAvailable: () => parentAvailable,
      onWorkerSettled: settled,
    });

    await delegate.execute({ task: "child" });
    parentAvailable = false;
    await store.delete("deleted-parent");
    release?.();

    await vi.waitFor(() => expect(settled).toHaveBeenCalledTimes(1));
    await expect(store.load("deleted-parent")).resolves.toBeNull();
    await expect(store.peekMailbox("deleted-parent")).resolves.toEqual([]);
  });

  it("transitions tasks row to failed status if synchronous worker spawning throws", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    const store = new SessionStore(sessionsDir);

    await store.save(
      createSessionData({
        sessionId: "parent-spawn-fail",
        taskId: "parent-task",
        prompt: "parent",
        agentName: "orchestrator",
        messages: [],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );

    sessionRepo.create({
      id: "parent-spawn-fail",
      prompt: "parent",
      agentName: "orchestrator",
      createdAt: Date.now(),
    });

    const delegate = createDelegateTool({
      db,
      sessionId: "parent-spawn-fail",
      sessionsDir,
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerSpawned: () => {
        throw new Error("Synchronous spawning error");
      },
    });

    await expect(delegate.execute({ task: "failing spawn" })).rejects.toThrow(
      "Synchronous spawning error",
    );

    const taskStmt = db.prepare<[], { status: string; error_message: string | null }>(
      "SELECT status, error_message FROM tasks WHERE parent_session_id = 'parent-spawn-fail'",
    );
    const task = taskStmt.get();

    expect(task).toBeDefined();
    expect(task?.status).toBe("failed");
    expect(task?.error_message).toContain("Synchronous spawning error");

    db.close();
  });

  it("compensates the reserved task and worker session when initial file persistence fails", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    new SessionRepository(db).create({
      id: "parent-file-fail",
      agentName: "orchestrator",
      prompt: "parent",
    });
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({ sessionId: "parent-file-fail", agentName: "orchestrator" }),
    );
    vi.spyOn(SessionStore.prototype, "save").mockRejectedValueOnce(
      new Error("worker file creation failed"),
    );
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-file-fail",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
    });

    await expect(delegate.execute({ task: "cannot persist worker" })).rejects.toThrow(
      "worker file creation failed",
    );
    expect(new TaskRepository(db).listByParent("parent-file-fail")).toEqual([]);
    expect(
      db
        .prepare<[string], { count: number }>(
          "SELECT COUNT(*) AS count FROM sessions WHERE id != ?",
        )
        .get("parent-file-fail")?.count ?? 0,
    ).toBe(0);
    expect((await readdir(sessionsDir)).filter((name) => name.startsWith("worker-"))).toEqual([]);
    db.close();
  });

  it("transitions tasks row to failed and delivers failure mailbox event if worker.run throws", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    const store = new SessionStore(sessionsDir);

    await store.save(
      createSessionData({
        sessionId: "parent-run-fail",
        taskId: "parent-task",
        prompt: "parent",
        agentName: "orchestrator",
        messages: [],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );

    sessionRepo.create({
      id: "parent-run-fail",
      prompt: "parent",
      agentName: "orchestrator",
      createdAt: Date.now(),
    });

    let resolveCompletion: ((pending: PendingMessage) => void) | undefined;
    const completion = new Promise<PendingMessage>((resolve) => {
      resolveCompletion = resolve;
    });

    const delegate = createDelegateTool({
      db,
      sessionId: "parent-run-fail",
      sessionsDir,
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          throw new Error("LLM worker crash");
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerCompleted: (_sessionId, pending) => resolveCompletion?.(pending),
    });

    await delegate.execute({ task: "worker crash task" });
    const pending = await completion;

    expect(pending.status).toBe("error");
    expect(pending.summary).toContain("LLM worker crash");

    const taskStmt = db.prepare<[], { status: string; error_message: string | null }>(
      "SELECT status, error_message FROM tasks WHERE parent_session_id = 'parent-run-fail'",
    );
    const task = taskStmt.get();

    expect(task?.status).toBe("failed");
    expect(task?.error_message).toContain("LLM worker crash");

    const mailboxPending = mailboxRepo.peekPending("parent-run-fail");
    expect(mailboxPending).toHaveLength(1);
    expect(mailboxPending[0]?.payload).toContain("LLM worker crash");

    db.close();
  });

  it("settles exactly one failure when the completed worker transcript cannot be saved", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    new SessionRepository(db).create({
      id: "parent-final-save-fail",
      agentName: "orchestrator",
      prompt: "parent",
    });
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-final-save-fail", agentName: "orchestrator" }),
    );
    const originalSave = SessionStore.prototype.save;
    vi.spyOn(SessionStore.prototype, "save").mockImplementation(async (data) => {
      if (data.result?.status === "done") throw new Error("final worker transcript save failed");
      return originalSave.call(new SessionStore(sessionsDir), data);
    });
    let markSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const completions: PendingMessage[] = [];
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-final-save-fail",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerCompleted: (_sessionId, pending) => completions.push(pending),
      onWorkerSettled: () => markSettled?.(),
    });

    await delegate.execute({ task: "final save failure" });
    await settled;

    expect(new TaskRepository(db).listByParent("parent-final-save-fail")[0]?.status).toBe("failed");
    const mailbox = new MailboxRepository(db).peekPending("parent-final-save-fail");
    expect(mailbox).toHaveLength(1);
    expect(JSON.parse(mailbox[0]?.payload ?? "{}")).toEqual(
      expect.objectContaining({ status: "error", summary: expect.stringContaining("save failed") }),
    );
    expect(completions).toEqual([
      expect.objectContaining({ status: "error", summary: expect.stringContaining("save failed") }),
    ]);
    db.close();
  });

  it("rolls back a terminal transition when mailbox enqueue fails", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    db.exec(`
      CREATE TRIGGER fail_worker_mailbox_enqueue
      BEFORE INSERT ON mailbox_events
      BEGIN
        SELECT RAISE(ABORT, 'INJECTED_MAILBOX_ENQUEUE_FAILURE');
      END;
    `);
    const sessionRepo = new SessionRepository(db);
    sessionRepo.create({ id: "parent-enqueue-fail", agentName: "orchestrator", prompt: "parent" });
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-enqueue-fail", agentName: "orchestrator" }),
    );
    let markSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const backgroundErrors: unknown[] = [];
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-enqueue-fail",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onBackgroundError: (error) => backgroundErrors.push(error),
      onWorkerSettled: () => markSettled?.(),
    });

    await delegate.execute({ task: "enqueue failure" });
    await settled;

    const task = new TaskRepository(db).listByParent("parent-enqueue-fail")[0];
    expect(task?.status).toBe("running");
    expect(task?.completed_at).toBeNull();
    expect(new MailboxRepository(db).countPending("parent-enqueue-fail")).toBe(0);
    expect(backgroundErrors).toHaveLength(1);
    expect(backgroundErrors[0]).toEqual(
      expect.objectContaining({
        message: expect.stringContaining("INJECTED_MAILBOX_ENQUEUE_FAILURE"),
      }),
    );
    db.close();
  });

  it("retries a transient atomic settlement failure without duplicating delivery", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    new SessionRepository(db).create({
      id: "parent-transient-enqueue",
      agentName: "orchestrator",
      prompt: "parent",
    });
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-transient-enqueue", agentName: "orchestrator" }),
    );
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let markSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const completions: PendingMessage[] = [];
    const backgroundErrors: unknown[] = [];
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-transient-enqueue",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          await gate;
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerCompleted: (_sessionId, pending) => completions.push(pending),
      onBackgroundError: (error) => backgroundErrors.push(error),
      onWorkerSettled: () => markSettled?.(),
    });

    await delegate.execute({ task: "transient enqueue failure" });
    const originalImmediateTransaction = db.immediateTransaction.bind(db);
    let settlementAttempts = 0;
    vi.spyOn(db, "immediateTransaction").mockImplementation((fn) => {
      settlementAttempts += 1;
      if (settlementAttempts === 1) {
        return () => {
          throw new Error("transient settlement failure");
        };
      }
      return originalImmediateTransaction(fn);
    });
    release?.();
    await settled;

    expect(settlementAttempts).toBeGreaterThan(1);
    expect(new TaskRepository(db).listByParent("parent-transient-enqueue")[0]?.status).toBe(
      "completed",
    );
    expect(new MailboxRepository(db).countPending("parent-transient-enqueue")).toBe(1);
    expect(completions).toEqual([expect.objectContaining({ status: "done" })]);
    expect(backgroundErrors).toEqual([]);
    db.close();
  });

  it("commits a successful terminal transition with its mailbox event", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    const sessionRepo = new SessionRepository(db);
    sessionRepo.create({ id: "parent-success", agentName: "orchestrator", prompt: "parent" });
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-success", agentName: "orchestrator" }),
    );
    let markSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-success",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerSettled: () => markSettled?.(),
    });

    await delegate.execute({ task: "successful task" });
    await settled;

    const task = new TaskRepository(db).listByParent("parent-success")[0];
    expect(task?.status).toBe("completed");
    expect(task?.completed_at).not.toBeNull();
    expect(new MailboxRepository(db).countPending("parent-success")).toBe(1);
    db.close();
  });

  it("keeps the committed DB result authoritative when legacy mailbox append fails", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    new SessionRepository(db).create({
      id: "parent-legacy-append-fail",
      agentName: "orchestrator",
      prompt: "parent",
    });
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-legacy-append-fail", agentName: "orchestrator" }),
    );
    vi.spyOn(SessionStore.prototype, "appendMailbox").mockRejectedValueOnce(
      new Error("legacy mailbox write failed"),
    );
    let markSettled: (() => void) | undefined;
    const settled = new Promise<void>((resolve) => {
      markSettled = resolve;
    });
    const completions: PendingMessage[] = [];
    const backgroundErrors: unknown[] = [];
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-legacy-append-fail",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerCompleted: (_sessionId, pending) => completions.push(pending),
      onBackgroundError: (error) => backgroundErrors.push(error),
      onWorkerSettled: () => markSettled?.(),
    });

    await delegate.execute({ task: "successful task with legacy failure" });
    await settled;

    const task = new TaskRepository(db).listByParent("parent-legacy-append-fail")[0];
    expect(task?.status).toBe("completed");
    const mailbox = new MailboxRepository(db).peekPending("parent-legacy-append-fail");
    expect(mailbox).toHaveLength(1);
    expect(JSON.parse(mailbox[0]?.payload ?? "{}")).toEqual(
      expect.objectContaining({ status: "done", summary: "done" }),
    );
    expect(completions).toEqual([expect.objectContaining({ status: "done", summary: "done" })]);
    expect(backgroundErrors).toEqual([
      expect.objectContaining({ message: "legacy mailbox write failed" }),
    ]);
    db.close();
  });

  it("atomically allows only one of two concurrent 100th active delegations", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    const sessionRepo = new SessionRepository(db);
    sessionRepo.create({ id: "parent-at-99", agentName: "orchestrator", prompt: "parent" });
    const taskRepo = new TaskRepository(db);
    for (let index = 0; index < 99; index += 1) {
      taskRepo.create({
        taskId: `existing-${index}`,
        parentSessionId: "parent-at-99",
        description: "active",
        status: "running",
      });
    }
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-at-99", agentName: "orchestrator" }),
    );
    let release: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let settledCount = 0;
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-at-99",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          await gate;
          return { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      capabilityRegistry: createPermissiveCapabilityRegistry(sessionsDir),
      onWorkerSettled: () => {
        settledCount += 1;
      },
    });

    const results = await Promise.allSettled([
      delegate.execute({ task: "one more A" }),
      delegate.execute({ task: "one more B" }),
    ]);
    const activeCountAtReservation = taskRepo.listByParent("parent-at-99", "running").length;

    release?.();
    const fulfilled = results.filter((result) => result.status === "fulfilled");
    const rejected = results.filter((result) => result.status === "rejected");
    await vi.waitFor(() => expect(settledCount).toBe(fulfilled.length));

    expect(fulfilled).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(activeCountAtReservation).toBe(100);
    expect(rejected[0]).toEqual(
      expect.objectContaining({
        reason: expect.objectContaining({
          message: expect.stringContaining("active delegation limit"),
        }),
      }),
    );
    db.close();
  });

  it("rejects the 101st active delegation before creating durable worker state", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();
    const sessionRepo = new SessionRepository(db);
    sessionRepo.create({ id: "parent-at-cap", agentName: "orchestrator", prompt: "parent" });
    const taskRepo = new TaskRepository(db);
    for (let index = 0; index < 100; index += 1) {
      taskRepo.create({
        taskId: `existing-${index}`,
        parentSessionId: "parent-at-cap",
        description: "active",
        status: "running",
      });
    }
    const sessionsDir = await mkdtemp(path.join(tmpdir(), "agent-harness-delegation-"));
    tempDirs.push(sessionsDir);
    await new SessionStore(sessionsDir).save(
      createSessionData({ sessionId: "parent-at-cap", agentName: "orchestrator" }),
    );
    const delegate = createDelegateTool({
      db,
      sessionsDir,
      sessionId: "parent-at-cap",
      resolveConfig: () => ({
        name: "orchestrator",
        model: "fake-model",
        tools: [],
        maxSteps: 1,
        instructions: "Test",
      }),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return { finishReason: "stop", message: { role: "assistant", content: "unused" } };
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });
    await expect(delegate.execute({ task: "over capacity" })).rejects.toThrow(
      "active delegation limit",
    );
    expect(taskRepo.listByParent("parent-at-cap")).toHaveLength(100);
    expect(sessionRepo.listMeta({ limit: 200 })).toHaveLength(1);
    expect((await readdir(sessionsDir)).filter((entry) => entry.startsWith("worker-"))).toEqual([]);

    db.close();
  });
});
