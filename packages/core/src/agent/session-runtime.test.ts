import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetModelsDevCache } from "../capability/models-dev-client.js";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMChatParams, LLMClient, LLMResponse } from "../llm/client.js";
import { createSessionData, SessionStore } from "../persistence/session.js";
import {
  createDatabaseConnection,
  MailboxRepository,
  MessageRepository,
  RunRepository,
  SessionRepository,
  SqliteMigrator,
  TaskRepository,
} from "../persistence/sqlite/index.js";
import { ExecutionLimiter } from "../runtime/execution-limiter.js";
import { ToolRegistry } from "../tool/registry.js";
import { SessionRuntime } from "./session-runtime.js";
import type { AgentConfig } from "./types.js";

const tempDirs: string[] = [];

async function makeDirectory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-harness-runtime-"));
  tempDirs.push(dir);
  return dir;
}

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolvePromise: ((value: T) => void) | undefined;
  const promise = new Promise<T>((resolve) => {
    resolvePromise = resolve;
  });
  return {
    promise,
    resolve(value) {
      if (!resolvePromise) throw new Error("Deferred promise is not initialized");
      resolvePromise(value);
    },
  };
}

function config(tools: string[] = []): AgentConfig {
  return {
    name: "orchestrator",
    model: "fake-model",
    tools,
    maxSteps: 2,
    instructions: "Test runtime invariants.",
  };
}

function stop(content: string): LLMResponse {
  return {
    finishReason: "stop",
    message: { role: "assistant", content },
  };
}

const DELIVERY_A = "11111111-1111-4111-8111-111111111111";
const DELIVERY_B = "22222222-2222-4222-8222-222222222222";

beforeEach(() => {
  resetModelsDevCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetModelsDevCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SessionRuntime delivery invariants", () => {
  it("persists streamed reasoning without exposing it as a text delta", async () => {
    const sessionsDir = await makeDirectory();
    const capabilities = new CapabilityRegistry({ workspaceRoot: sessionsDir });
    vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: true,
      structuredOutputs: true,
      promptCaching: false,
      reasoning: true,
      maxTokens: 0,
    });
    const runtime = new SessionRuntime({
      sessionId: "stream-reasoning",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield { type: "reasoning-delta" as const, reasoning: "private thought" };
          yield { type: "text-delta" as const, text: "public answer" };
          yield { type: "finish" as const, finishReason: "stop" as const };
        },
      },
      capabilityRegistry: capabilities,
    });
    const events: Array<{ type: string; text?: string }> = [];
    runtime.on((event) => events.push(event));

    await runtime.deliver("go", undefined, undefined, "request-1");

    const saved = await new SessionStore(sessionsDir).load("stream-reasoning");
    expect(saved?.messages.at(-1)).toEqual(
      expect.objectContaining({
        role: "assistant",
        content: "public answer",
        reasoning: "private thought",
      }),
    );
    expect(events).toContainEqual(
      expect.objectContaining({ type: "agent:text-delta", text: "public answer" }),
    );
    expect(events).not.toContainEqual(expect.objectContaining({ text: "private thought" }));
  });

  it("does not persist output emitted after a terminal stream event", async () => {
    const sessionsDir = await makeDirectory();
    const capabilities = new CapabilityRegistry({ workspaceRoot: sessionsDir });
    vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: true,
      structuredOutputs: true,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    const runtime = new SessionRuntime({
      sessionId: "post-finish",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield { type: "finish" as const, finishReason: "stop" as const };
          yield { type: "text-delta" as const, text: "must not persist" };
        },
      },
      capabilityRegistry: capabilities,
    });

    await expect(runtime.deliver("go")).rejects.toThrow("after terminal finish");

    const saved = await new SessionStore(sessionsDir).load("post-finish");
    expect(saved?.messages).toEqual([expect.objectContaining({ role: "user", content: "go" })]);
  });

  it("persists TTFT and token throughput in durable run metadata", async () => {
    vi.useFakeTimers();
    const db = createDatabaseConnection(":memory:");
    try {
      new SqliteMigrator(db).up();
      new SessionRepository(db).create({
        id: "stream-metrics",
        agentName: "orchestrator",
        prompt: "",
      });
      const capabilities = new CapabilityRegistry({ workspaceRoot: tmpdir() });
      vi.spyOn(capabilities, "lookup").mockResolvedValue({
        chat: true,
        tools: true,
        vision: true,
        streaming: true,
        structuredOutputs: true,
        promptCaching: false,
        reasoning: false,
        maxTokens: 0,
      });
      vi.setSystemTime(new Date("2026-08-23T00:00:00.000Z"));
      const runtime = new SessionRuntime({
        sessionId: "stream-metrics",
        db,
        resolveConfig: () => config(),
        toolRegistry: new ToolRegistry(),
        llmClient: {
          async chat() {
            throw new Error("blocking pathway must not run");
          },
          async *chatStream() {
            vi.setSystemTime(new Date("2026-08-23T00:00:00.120Z"));
            yield { type: "text-delta" as const, text: "streamed" };
            vi.setSystemTime(new Date("2026-08-23T00:00:01.120Z"));
            yield {
              type: "finish" as const,
              finishReason: "stop" as const,
              usage: { inputTokens: 4, outputTokens: 10, totalTokens: 14 },
            };
          },
        },
        capabilityRegistry: capabilities,
      });

      await runtime.deliver("go");

      const runs = new RunRepository(db).listBySession("stream-metrics");
      expect(JSON.parse(runs[0]?.token_usage ?? "null")).toEqual({
        streaming: {
          steps: [{ ttftMs: 120, tokensPerSecond: 10, outputTokens: 10, durationMs: 1120 }],
        },
      });
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });

  it("serializes concurrent deliveries for one session", async () => {
    const sessionsDir = await makeDirectory();
    const firstResponse = deferred<LLMResponse>();
    const chat = vi.fn(async (_params: LLMChatParams) => {
      if (chat.mock.calls.length === 1) return firstResponse.promise;
      return stop("second complete");
    });
    const llmClient: LLMClient = { chat };
    const capabilities = new CapabilityRegistry({ workspaceRoot: sessionsDir });
    vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: true,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    const runtime = new SessionRuntime({
      sessionId: "serialized",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient,
      capabilityRegistry: capabilities,
    });

    const first = runtime.deliver("first");
    const second = runtime.deliver("second");
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    expect(chat).toHaveBeenCalledTimes(1);

    firstResponse.resolve(stop("first complete"));
    await expect(first).resolves.toEqual(expect.objectContaining({ status: "success" }));
    await expect(second).resolves.toEqual(expect.objectContaining({ status: "success" }));
    expect(chat).toHaveBeenCalledTimes(2);

    const saved = await new SessionStore(sessionsDir).load("serialized");
    expect(saved?.messages.map((message) => message.content)).toEqual([
      "first",
      "first complete",
      "second",
      "second complete",
    ]);
  });

  it("retries an existing user delivery without duplicating its durable message", async () => {
    const sessionsDir = await makeDirectory();
    const chat = vi
      .fn<(params: LLMChatParams) => Promise<LLMResponse>>()
      .mockRejectedValueOnce(new Error("provider unavailable"))
      .mockResolvedValueOnce(stop("recovered"));
    const runtime = new SessionRuntime({
      sessionId: "retry",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await expect(
      runtime.deliver("original prompt", undefined, undefined, undefined, DELIVERY_A),
    ).rejects.toThrow("provider unavailable");
    await expect(
      runtime.retry("original prompt", undefined, undefined, undefined, DELIVERY_A),
    ).resolves.toEqual(expect.objectContaining({ status: "success" }));

    const saved = await new SessionStore(sessionsDir).load("retry");
    expect(
      saved?.messages.map((message) => [
        message.role === "user" ? message.deliveryId : undefined,
        message.role,
        message.content,
      ]),
    ).toEqual([
      [DELIVERY_A, "user", "original prompt"],
      [undefined, "assistant", "recovered"],
    ]);
  });

  it("persists consecutive identical prompts when the retry identity is absent", async () => {
    const sessionsDir = await makeDirectory();
    const chat = vi
      .fn<(params: LLMChatParams) => Promise<LLMResponse>>()
      .mockResolvedValueOnce(stop("first answer"))
      .mockResolvedValueOnce(stop("second answer"));
    const runtime = new SessionRuntime({
      sessionId: "distinct-identical-deliveries",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver("same prompt", undefined, undefined, undefined, DELIVERY_A);
    await runtime.retry("same prompt", undefined, undefined, undefined, DELIVERY_B);

    const saved = await new SessionStore(sessionsDir).load("distinct-identical-deliveries");
    expect(
      saved?.messages.map((message) => [
        message.role === "user" ? message.deliveryId : undefined,
        message.role,
        message.content,
      ]),
    ).toEqual([
      [DELIVERY_A, "user", "same prompt"],
      [undefined, "assistant", "first answer"],
      [DELIVERY_B, "user", "same prompt"],
      [undefined, "assistant", "second answer"],
    ]);
  });

  it("rejects an exact delivery identity when its durable content differs", async () => {
    const sessionsDir = await makeDirectory();
    const chat = vi.fn<(params: LLMChatParams) => Promise<LLMResponse>>(async () => stop("answer"));
    const runtime = new SessionRuntime({
      sessionId: "delivery-content-mismatch",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver("original content", undefined, undefined, undefined, DELIVERY_A);
    await expect(
      runtime.retry("changed content", undefined, undefined, undefined, DELIVERY_A),
    ).rejects.toThrow("Delivery identity does not match the durable user message");

    const saved = await new SessionStore(sessionsDir).load("delivery-content-mismatch");
    expect(saved?.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "original content"],
      ["assistant", "answer"],
    ]);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("rejects a duplicate delivery identity on a non-retry request", async () => {
    const sessionsDir = await makeDirectory();
    const chat = vi.fn<(params: LLMChatParams) => Promise<LLMResponse>>(async () => stop("answer"));
    const runtime = new SessionRuntime({
      sessionId: "duplicate-fresh-delivery",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver("same content", undefined, undefined, undefined, DELIVERY_A);
    await expect(
      runtime.deliver("same content", undefined, undefined, undefined, DELIVERY_A),
    ).rejects.toThrow("Delivery identity is already durable; retry is required");

    expect(
      (await new SessionStore(sessionsDir).load("duplicate-fresh-delivery"))?.messages,
    ).toHaveLength(2);
    expect(chat).toHaveBeenCalledTimes(1);
  });

  it("treats a retry with no matching durable user as a fresh delivery", async () => {
    const sessionsDir = await makeDirectory();
    const runtime = new SessionRuntime({
      sessionId: "retry-without-durable-user",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat: vi.fn(async () => stop("delivered")) },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await expect(runtime.retry("unknown delivery")).resolves.toEqual(
      expect.objectContaining({ status: "success" }),
    );

    const saved = await new SessionStore(sessionsDir).load("retry-without-durable-user");
    expect(saved?.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "unknown delivery"],
      ["assistant", "delivered"],
    ]);
  });

  it("preserves latest-content replay for a legacy retry without an identity", async () => {
    const sessionsDir = await makeDirectory();
    const chat = vi
      .fn<(params: LLMChatParams) => Promise<LLMResponse>>()
      .mockResolvedValueOnce(stop("first answer"))
      .mockResolvedValueOnce(stop("second answer"));
    const runtime = new SessionRuntime({
      sessionId: "legacy-identical-retry",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver("same prompt");
    await runtime.retry("same prompt");

    const saved = await new SessionStore(sessionsDir).load("legacy-identical-retry");
    expect(saved?.messages.map((message) => [message.role, message.content])).toEqual([
      ["user", "same prompt"],
      ["assistant", "first answer"],
      ["assistant", "second answer"],
    ]);
  });

  it("does not replay matching content from before a newer durable user turn", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({
        sessionId: "stale-matching-retry",
        prompt: "newer prompt",
        messages: [
          { role: "user", content: "repeated prompt" },
          { role: "assistant", content: "older answer" },
          { role: "user", content: "newer prompt" },
          { role: "assistant", content: "newer answer" },
        ],
      }),
    );
    const runtime = new SessionRuntime({
      sessionId: "stale-matching-retry",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat: vi.fn(async () => stop("fresh answer")) },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.retry("repeated prompt");

    const saved = await store.load("stale-matching-retry");
    expect(saved?.messages.slice(-2).map((message) => [message.role, message.content])).toEqual([
      ["user", "repeated prompt"],
      ["assistant", "fresh answer"],
    ]);
  });

  it("reconciles a queued retry after the original delivery becomes durable", async () => {
    const sessionsDir = await makeDirectory();
    const originalResponse = deferred<LLMResponse>();
    const chat = vi
      .fn<(params: LLMChatParams) => Promise<LLMResponse>>()
      .mockImplementationOnce(() => originalResponse.promise)
      .mockResolvedValueOnce(stop("retry complete"));
    const runtime = new SessionRuntime({
      sessionId: "queued-retry",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: { chat },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    const original = runtime.deliver("same prompt", undefined, undefined, undefined, DELIVERY_A);
    await vi.waitFor(() => expect(chat).toHaveBeenCalledTimes(1));
    const retry = runtime.retry("same prompt", undefined, undefined, undefined, DELIVERY_A);
    originalResponse.resolve(stop("original complete"));

    await expect(original).resolves.toEqual(expect.objectContaining({ status: "success" }));
    await expect(retry).resolves.toEqual(expect.objectContaining({ status: "success" }));

    const saved = await new SessionStore(sessionsDir).load("queued-retry");
    expect(saved?.messages.filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({ deliveryId: DELIVERY_A, content: "same prompt" }),
    ]);
    expect(saved?.messages.map((message) => message.content)).toEqual([
      "same prompt",
      "original complete",
      "retry complete",
    ]);
  });

  it("drains worker completions together and removes delegate from a wake run", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({
        sessionId: "wake",
        taskId: "parent-task",
        prompt: "original",
        agentName: "orchestrator",
        messages: [{ role: "user", content: "original" }],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    await Promise.all([
      store.appendMailbox("wake", {
        taskId: "worker-1",
        from: "worker-session-1",
        agentName: "worker-one",
        status: "done",
        summary: "first result",
        receivedAt: "2026-08-11T00:01:00.000Z",
      }),
      store.appendMailbox("wake", {
        taskId: "worker-2",
        from: "worker-session-2",
        agentName: "worker-two",
        status: "error",
        summary: "second failure",
        receivedAt: "2026-08-11T00:02:00.000Z",
      }),
    ]);

    const registry = new ToolRegistry();
    for (const name of ["delegate", "safe"]) {
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
        observed.push({ ...params, messages: params.messages.map((message) => ({ ...message })) });
        return stop("reported completion");
      },
    };
    const runtime = new SessionRuntime({
      sessionId: "wake",
      sessionsDir,
      resolveConfig: () => config(["delegate", "safe"]),
      toolRegistry: registry,
      llmClient,
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver();

    expect(observed).toHaveLength(1);
    expect(observed[0]?.tools?.map((tool) => tool.name)).toEqual(["safe"]);
    expect(observed[0]?.messages.slice(-2).map((message) => message.meta)).toEqual([
      expect.objectContaining({ kind: "worker_completed", taskId: "worker-1", status: "done" }),
      expect.objectContaining({ kind: "worker_completed", taskId: "worker-2", status: "error" }),
    ]);
    const saved = await store.load("wake");
    expect(saved?.mailbox).toEqual([]);
    expect(saved?.messages.at(-1)?.content).toBe("reported completion");
  });

  it("persists the same delivery and prompt order that the model receives", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({
        sessionId: "ordered",
        taskId: "parent-task",
        prompt: "old prompt",
        agentName: "orchestrator",
        messages: [{ role: "user", content: "old prompt" }],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    await store.appendMailbox("ordered", {
      taskId: "worker-order",
      from: "worker-session",
      agentName: "worker",
      status: "done",
      summary: "worker result",
      receivedAt: "2026-08-11T00:01:00.000Z",
    });
    let observed: LLMChatParams | undefined;
    const runtime = new SessionRuntime({
      sessionId: "ordered",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat(params) {
          observed = params;
          return stop("answer");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver("new prompt");

    const expectedPrefix = ["old prompt", expect.stringContaining("worker result"), "new prompt"];
    expect(observed?.messages.map((message) => message.content)).toEqual(expectedPrefix);
    const saved = await store.load("ordered");
    expect(saved?.messages.slice(0, 3).map((message) => message.content)).toEqual(expectedPrefix);
  });

  it("recovers a materialized but unacknowledged completion without duplicating it", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    const materialized = {
      role: "system" as const,
      content: "already materialized",
      meta: { kind: "worker_completed", taskId: "worker-recovery" },
    };
    await store.save(
      createSessionData({
        sessionId: "recovery",
        taskId: "parent-task",
        prompt: "old prompt",
        agentName: "orchestrator",
        messages: [{ role: "user", content: "old prompt" }, materialized],
        createdAt: "2026-08-11T00:00:00.000Z",
      }),
    );
    await store.appendMailbox("recovery", {
      taskId: "worker-recovery",
      from: "worker-session",
      agentName: "worker",
      status: "done",
      summary: "worker result",
      receivedAt: "2026-08-11T00:01:00.000Z",
    });
    const runtime = new SessionRuntime({
      sessionId: "recovery",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("reported");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await runtime.deliver();

    const saved = await store.load("recovery");
    expect(
      saved?.messages.filter((message) => message.meta && message.content === materialized.content),
    ).toHaveLength(1);
    expect(saved?.mailbox).toEqual([]);
  });

  it("persists assistant and tool messages when a later provider call fails", async () => {
    const sessionsDir = await makeDirectory();
    const registry = new ToolRegistry();
    registry.register({
      name: "work",
      description: "work",
      parameters: z.object({}),
      async execute() {
        return "tool result";
      },
    });
    let calls = 0;
    const runtime = new SessionRuntime({
      sessionId: "partial-failure",
      sessionsDir,
      resolveConfig: () => config(["work"]),
      toolRegistry: registry,
      llmClient: {
        async chat() {
          calls += 1;
          if (calls === 1) {
            return {
              finishReason: "tool-calls",
              message: {
                role: "assistant",
                content: "",
                toolCalls: [{ toolCallId: "call-1", toolName: "work", args: {} }],
              },
              toolCalls: [{ toolCallId: "call-1", toolName: "work", args: {} }],
            };
          }
          throw new Error("provider failed");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    await expect(runtime.deliver("start")).rejects.toThrow("provider failed");

    const saved = await new SessionStore(sessionsDir).load("partial-failure");
    expect(saved?.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(saved?.messages.at(-1)?.content).toBe("tool result");
    expect(saved?.result).toEqual(expect.objectContaining({ status: "error" }));
  });

  it("records completion time after execution finishes", async () => {
    vi.useFakeTimers();
    try {
      const sessionsDir = await makeDirectory();
      const response = deferred<LLMResponse>();
      const runtime = new SessionRuntime({
        sessionId: "completion-time",
        sessionsDir,
        resolveConfig: () => config(),
        toolRegistry: new ToolRegistry(),
        llmClient: {
          async chat() {
            return response.promise;
          },
        },
        capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      });
      vi.setSystemTime(new Date("2026-08-15T10:00:00.000Z"));
      const run = runtime.deliver("work");
      await vi.waitFor(() => undefined);
      vi.setSystemTime(new Date("2026-08-15T10:05:00.000Z"));
      response.resolve(stop("done"));

      await run;

      const saved = await new SessionStore(sessionsDir).load("completion-time");
      expect(saved?.completedAt).toBe("2026-08-15T10:05:00.000Z");
    } finally {
      vi.useRealTimers();
    }
  });

  it("emits agent started only after the execution limiter admits the run", async () => {
    const sessionsDir = await makeDirectory();
    const limiter = new ExecutionLimiter(1);
    const gate = deferred<void>();
    const occupying = limiter.run(async () => gate.promise);
    const events: string[] = [];
    const runtime = new SessionRuntime({
      sessionId: "queued-runtime",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("done");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      executionLimiter: limiter,
      onEvent(event) {
        events.push(event.type);
      },
    });

    const run = runtime.deliver("work");
    await vi.waitFor(() => expect(limiter.snapshot().queued).toBe(1));
    expect(events).not.toContain("agent:started");
    gate.resolve();
    await Promise.all([occupying, run]);
    expect(events).toContain("agent:started");
  });

  it("does not abort execution if mailbox acknowledgment fails", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    await store.save(
      createSessionData({
        sessionId: "ack-fail",
        taskId: "task-1",
        prompt: "init",
        messages: [],
        createdAt: "2026-08-15T00:00:00.000Z",
      }),
    );
    await store.appendMailbox("ack-fail", {
      taskId: "w-1",
      from: "worker",
      agentName: "worker",
      status: "done",
      summary: "worker done",
      receivedAt: "2026-08-15T00:01:00.000Z",
    });

    vi.spyOn(SessionStore.prototype, "acknowledgeMailbox").mockRejectedValueOnce(
      new Error("disk error on ack"),
    );

    const runtime = new SessionRuntime({
      sessionId: "ack-fail",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("Handled completion.");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
    });

    const result = await runtime.deliver();
    expect(result.status).toBe("success");
    const saved = await store.load("ack-fail");
    expect(saved?.result?.status).toBe("success");
  });

  it("does not save to disk if the session was deleted before completion", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    let available = true;

    const runtime = new SessionRuntime({
      sessionId: "deleted-midrun",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          available = false;
          await store.delete("deleted-midrun");
          return stop("finished after deletion");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      isSessionAvailable: () => available,
    });

    await runtime.deliver("work");
    expect(await store.load("deleted-midrun")).toBeNull();
  });

  it("does not write initial transcript or resurrect deleted session when isSessionAvailable is false upfront", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);

    const runtime = new SessionRuntime({
      sessionId: "already-deleted",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("should not run");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      isSessionAvailable: () => false,
    });

    const result = await runtime.deliver("work");
    expect(result.status).toBe("cancelled");
    expect(await store.load("already-deleted")).toBeNull();
  });

  it("executes transactional mailbox drain atomically in SQLite with rollback safety", async () => {
    const db = createDatabaseConnection(":memory:");
    const migrator = new SqliteMigrator(db);
    migrator.up();

    const sessionRepo = new SessionRepository(db);
    const taskRepo = new TaskRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    const messageRepo = new MessageRepository(db);

    sessionRepo.create({
      id: "tx-sess",
      agentName: "orchestrator",
      prompt: "tx prompt",
    });

    taskRepo.create({
      taskId: "tx-task-1",
      parentSessionId: "tx-sess",
      description: "tx task description",
    });

    mailboxRepo.enqueue({
      parentSessionId: "tx-sess",
      taskId: "tx-task-1",
      eventType: "worker_completed",
      payload: {
        taskId: "tx-task-1",
        from: "worker-tx-task-1",
        agentName: "worker",
        status: "done",
        summary: "worker 1 completed successfully",
        receivedAt: "2026-08-18T00:00:00.000Z",
      },
    });

    expect(mailboxRepo.countPending("tx-sess")).toBe(1);

    const runtime = new SessionRuntime({
      sessionId: "tx-sess",
      db,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("Handled SQLite completion.");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: tmpdir() }),
    });

    const result = await runtime.deliver(
      "new user prompt",
      undefined,
      undefined,
      undefined,
      DELIVERY_A,
    );
    expect(result.status).toBe("success");

    // Verify mailbox event was acknowledged
    expect(mailboxRepo.countPending("tx-sess")).toBe(0);

    // Verify messages in SQLite table: system message, user message, assistant response
    const messages = messageRepo.listBySession("tx-sess");
    expect(messages.length).toBeGreaterThanOrEqual(3);
    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("worker 1 completed successfully");
    expect(messages[1]?.role).toBe("user");
    expect(messages[1]?.id).toBe(DELIVERY_A);
    expect(messages[1]?.content).toBe("new user prompt");
    expect(messages[2]?.role).toBe("assistant");
    expect(messages[2]?.content).toBe("Handled SQLite completion.");

    db.close();
  });

  it("materializes multiple concurrent worker completions with strict monotonic sequence numbers", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);
    const taskRepo = new TaskRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    const messageRepo = new MessageRepository(db);

    sessionRepo.create({
      id: "multi-worker-sess",
      agentName: "orchestrator",
      prompt: "Delegated multi tasks",
    });

    for (let i = 1; i <= 3; i += 1) {
      taskRepo.create({
        taskId: `multi-task-${i}`,
        parentSessionId: "multi-worker-sess",
        description: `Multi task ${i}`,
      });
      mailboxRepo.enqueue({
        parentSessionId: "multi-worker-sess",
        taskId: `multi-task-${i}`,
        eventType: "worker_completed",
        payload: {
          taskId: `multi-task-${i}`,
          from: `worker-multi-task-${i}`,
          agentName: `worker-${i}`,
          status: "done",
          summary: `Summary of task ${i}`,
          receivedAt: "2026-08-18T00:00:00.000Z",
        },
      });
    }

    expect(mailboxRepo.countPending("multi-worker-sess")).toBe(3);

    const runtime = new SessionRuntime({
      sessionId: "multi-worker-sess",
      db,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("Handled 3 worker completions.");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: tmpdir() }),
    });

    const result = await runtime.deliver("user follow-up");
    expect(result.status).toBe("success");
    expect(mailboxRepo.countPending("multi-worker-sess")).toBe(0);

    const messages = messageRepo.listBySession("multi-worker-sess");
    expect(messages).toHaveLength(5); // 3 worker system msgs + 1 user msg + 1 assistant msg

    // Verify monotonic sequence numbering
    for (let i = 0; i < messages.length; i += 1) {
      expect(messages[i]?.sequence_num).toBe(i);
    }

    expect(messages[0]?.role).toBe("system");
    expect(messages[0]?.content).toContain("Summary of task 1");
    expect(messages[1]?.role).toBe("system");
    expect(messages[1]?.content).toContain("Summary of task 2");
    expect(messages[2]?.role).toBe("system");
    expect(messages[2]?.content).toContain("Summary of task 3");
    expect(messages[3]?.role).toBe("user");
    expect(messages[3]?.content).toBe("user follow-up");
    expect(messages[4]?.role).toBe("assistant");
    expect(messages[4]?.content).toBe("Handled 3 worker completions.");

    db.close();
  });

  it("deduplicates duplicate taskId deliveries idempotently during mailbox drain", async () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);
    const taskRepo = new TaskRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    const messageRepo = new MessageRepository(db);

    sessionRepo.create({
      id: "dedup-sess",
      agentName: "orchestrator",
      prompt: "Dedup prompt",
    });

    taskRepo.create({
      taskId: "dup-task-1",
      parentSessionId: "dedup-sess",
      description: "Duplicate task",
    });

    // Enqueue two events for the exact same taskId
    mailboxRepo.enqueue({
      parentSessionId: "dedup-sess",
      taskId: "dup-task-1",
      eventType: "worker_completed",
      payload: {
        taskId: "dup-task-1",
        from: "worker-dup-task-1",
        agentName: "worker",
        status: "done",
        summary: "First delivery",
        receivedAt: "2026-08-18T00:00:00.000Z",
      },
    });

    mailboxRepo.enqueue({
      parentSessionId: "dedup-sess",
      taskId: "dup-task-1",
      eventType: "worker_completed",
      payload: {
        taskId: "dup-task-1",
        from: "worker-dup-task-1",
        agentName: "worker",
        status: "done",
        summary: "Duplicate second delivery",
        receivedAt: "2026-08-18T00:01:00.000Z",
      },
    });

    expect(mailboxRepo.countPending("dedup-sess")).toBe(1);

    const runtime = new SessionRuntime({
      sessionId: "dedup-sess",
      db,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient: {
        async chat() {
          return stop("Handled deduplicated completion.");
        },
      },
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: tmpdir() }),
    });

    const result = await runtime.deliver("user prompt");
    expect(result.status).toBe("success");
    expect(mailboxRepo.countPending("dedup-sess")).toBe(0);

    const messages = messageRepo.listBySession("dedup-sess");
    // Should contain exactly 1 system message for dup-task-1, not duplicate messages
    const systemMsgs = messages.filter((m) => m.role === "system");
    expect(systemMsgs).toHaveLength(1);
    expect(systemMsgs[0]?.content).toContain("Duplicate second delivery");

    db.close();
  });
});
