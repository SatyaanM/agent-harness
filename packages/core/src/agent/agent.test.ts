import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMClient } from "../llm/client.js";
import { ToolRegistry } from "../tool/registry.js";
import { Agent } from "./agent.js";
import type { AgentConfig } from "./types.js";

const config: AgentConfig = {
  name: "test-agent",
  model: "test-model",
  tools: ["count"],
  maxSteps: 2,
  instructions: "Test",
};

describe("Agent tool boundary", () => {
  it("validates provider-supplied tool arguments before execution", async () => {
    const execute = vi.fn(async (_args: { count: number }) => "executed");
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute,
    });

    let call = 0;
    const llmClient: LLMClient = {
      async chat() {
        call += 1;
        if (call === 1) {
          return {
            finishReason: "tool-calls",
            message: { role: "assistant", content: "" },
            toolCalls: [
              {
                toolCallId: "call-1",
                toolName: "count",
                args: { count: "not-a-number" },
              },
            ],
          };
        }
        return {
          finishReason: "stop",
          message: { role: "assistant", content: "done" },
        };
      },
    };

    const agent = new Agent(
      config,
      registry,
      llmClient,
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );
    const result = await agent.run("go");

    expect(execute).not.toHaveBeenCalled();
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("Expected number"),
        toolCallId: "call-1",
      }),
    );
  });
});
