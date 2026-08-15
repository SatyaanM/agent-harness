import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMClient } from "../llm/client.js";
import { ToolRegistry } from "../tool/registry.js";
import type { AgentConfig } from "./types.js";
import { Worker } from "./worker.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("Worker audit records", () => {
  it("returns the latest assistant and tool messages when a later provider call fails", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-worker-"));
    tempDirs.push(root);
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
    const llmClient: LLMClient = {
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
    };
    const config: AgentConfig = {
      name: "worker",
      model: "fake-model",
      tools: ["work"],
      maxSteps: 2,
      instructions: "work",
    };
    const worker = new Worker(
      "task-1",
      config,
      registry,
      llmClient,
      new CapabilityRegistry({ workspaceRoot: root }),
    );

    const result = await worker.run("start");

    expect(result.status).toBe("error");
    expect(result.messages.map((message) => message.role)).toEqual(["user", "assistant", "tool"]);
    expect(result.messages.at(-1)?.content).toBe("tool result");
  });
});
