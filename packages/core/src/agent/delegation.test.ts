import { mkdtemp, rm } from "node:fs/promises";
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
} from "../persistence/sqlite/index.js";
import { ToolRegistry } from "../tool/registry.js";
import { createDelegateTool } from "./delegation.js";
import type { AgentConfig } from "./types.js";

const tempDirs: string[] = [];

afterEach(async () => {
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
    const delegate = createDelegateTool({
      sessionsDir,
      sessionId: "parent-session",
      resolveConfig: () => parentConfig,
      toolRegistry: registry,
      llmClient,
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      onWorkerCompleted: (_sessionId, pending) => resolveCompletion?.(pending),
    });

    await delegate.execute({ task: "child task" });
    await expect(completion).resolves.toEqual(
      expect.objectContaining({ status: "done", summary: "worker complete" }),
    );

    expect(observed).toHaveLength(1);
    expect(observed[0]?.tools?.map((tool) => tool.name)).toEqual(["safe"]);
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
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
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
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
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
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
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
});
