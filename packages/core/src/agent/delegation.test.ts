import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMChatParams, LLMClient } from "../llm/client.js";
import { type PendingMessage, SessionStore } from "../persistence/session.js";
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
    await store.save({
      sessionId: "parent-session",
      taskId: "parent-task",
      prompt: "parent",
      agentName: "orchestrator",
      messages: [],
      createdAt: "2026-08-11T00:00:00.000Z",
    });
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
    await expect(store.drainMailbox("parent-session")).resolves.toEqual([
      expect.objectContaining({ status: "done", summary: "worker complete" }),
    ]);
  });
});
