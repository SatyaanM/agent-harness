import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMChatParams, LLMClient, LLMResponse } from "../llm/client.js";
import { SessionStore } from "../persistence/session.js";
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

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("SessionRuntime delivery invariants", () => {
  it("serializes concurrent deliveries for one session", async () => {
    const sessionsDir = await makeDirectory();
    const firstResponse = deferred<LLMResponse>();
    const chat = vi.fn(async (_params: LLMChatParams) => {
      if (chat.mock.calls.length === 1) return firstResponse.promise;
      return stop("second complete");
    });
    const llmClient: LLMClient = { chat };
    const runtime = new SessionRuntime({
      sessionId: "serialized",
      sessionsDir,
      resolveConfig: () => config(),
      toolRegistry: new ToolRegistry(),
      llmClient,
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
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

  it("drains worker completions together and removes delegate from a wake run", async () => {
    const sessionsDir = await makeDirectory();
    const store = new SessionStore(sessionsDir);
    await store.save({
      sessionId: "wake",
      taskId: "parent-task",
      prompt: "original",
      agentName: "orchestrator",
      messages: [{ role: "user", content: "original" }],
      createdAt: "2026-08-11T00:00:00.000Z",
    });
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
});
