import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMClient } from "../llm/client.js";
import { ToolRegistry } from "../tool/registry.js";
import { Agent } from "./agent.js";
import {
  AgentBudgetExceededError,
  AgentCancelledError,
  type AgentConfig,
  AgentResultSchema,
} from "./types.js";

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
        role: "assistant",
        toolCalls: [expect.objectContaining({ toolCallId: "call-1", toolName: "count" })],
      }),
    );
    expect(result.messages).toContainEqual(
      expect.objectContaining({
        role: "tool",
        content: expect.stringContaining("Expected number"),
        toolCallId: "call-1",
      }),
    );
  });

  it("rejects a pre-cancelled run before invoking the provider", async () => {
    const chat = vi.fn<LLMClient["chat"]>();
    const controller = new AbortController();
    controller.abort();
    const agent = new Agent(
      config,
      new ToolRegistry(),
      { chat },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    await expect(agent.run("go", [], controller.signal)).rejects.toBeInstanceOf(
      AgentCancelledError,
    );
    expect(chat).not.toHaveBeenCalled();
  });

  it("stops before exceeding the configured tool-call budget", async () => {
    const execute = vi.fn(async () => "executed");
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute,
    });
    const llmClient: LLMClient = {
      async chat() {
        return {
          finishReason: "tool-calls",
          message: { role: "assistant", content: "" },
          toolCalls: [
            { toolCallId: "call-1", toolName: "count", args: { count: 1 } },
            { toolCallId: "call-2", toolName: "count", args: { count: 2 } },
            { toolCallId: "call-3", toolName: "count", args: { count: 3 } },
          ],
        };
      },
    };
    const agent = new Agent(
      { ...config, maxToolCalls: 1 },
      registry,
      llmClient,
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("budgetExceeded");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(result.summary).toContain("tool-call budget");
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).toEqual(["call-1", "call-2", "call-3"]);
  });

  it("bounds tool results in model context without rewriting the transcript", async () => {
    const rawToolResult = "x".repeat(1_100_000);
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      async execute() {
        return rawToolResult;
      },
    });
    let call = 0;
    const chat = vi.fn<LLMClient["chat"]>(async () => {
      call += 1;
      return call === 1
        ? {
            finishReason: "tool-calls",
            message: { role: "assistant", content: "" },
            toolCalls: [{ toolCallId: "call-1", toolName: "count", args: { count: 1 } }],
            usage: { totalTokens: 1 },
          }
        : {
            finishReason: "stop",
            message: { role: "assistant", content: "done" },
            usage: { totalTokens: 1 },
          };
    });
    const completedResults: string[] = [];
    const agent = new Agent(
      { ...config, maxToolResultChars: 256 },
      registry,
      { chat },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
      (event) => {
        if (event.type === "tool:completed" && event.result) {
          completedResults.push(event.result);
        }
      },
    );

    const result = await agent.run("go");
    const transcriptResult = result.messages.find((message) => message.role === "tool")?.content;
    const providerResult = chat.mock.calls[1]?.[0].messages.find(
      (message) => message.role === "tool",
    )?.content;

    expect(transcriptResult).toBe(rawToolResult);
    expect(AgentResultSchema.safeParse(result).success).toBe(true);
    expect(providerResult).toContain("truncated");
    expect(providerResult?.length).toBeLessThanOrEqual(256);
    expect(completedResults).toHaveLength(1);
    expect(completedResults[0]).toContain("truncated");
    expect(completedResults[0]?.length).toBeLessThanOrEqual(256);
  });

  it("does not widen the provider response boundary for non-tool messages", async () => {
    const agent = new Agent(
      config,
      new ToolRegistry(),
      {
        async chat() {
          return {
            finishReason: "stop",
            message: { role: "assistant", content: "x".repeat(1_000_001) },
          };
        },
      },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    await expect(agent.run("go")).rejects.toThrow("provider response");
  });

  it("bounds a max-steps summary without rewriting its final tool message", async () => {
    const rawToolResult = "x".repeat(1_100_000);
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      async execute() {
        return rawToolResult;
      },
    });
    const agent = new Agent(
      { ...config, maxSteps: 1, maxToolResultChars: 256 },
      registry,
      {
        async chat() {
          return {
            finishReason: "tool-calls",
            message: { role: "assistant", content: "" },
            toolCalls: [{ toolCallId: "call-1", toolName: "count", args: { count: 1 } }],
            usage: { totalTokens: 1 },
          };
        },
      },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("maxStepsReached");
    expect(result.summary).toContain("truncated");
    expect(result.summary.length).toBeLessThanOrEqual(256);
    expect(result.messages.at(-1)?.content).toBe(rawToolResult);
    expect(AgentResultSchema.safeParse(result).success).toBe(true);
  });

  it("passes an output cap to the provider and stops after the total-token budget", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "finished" },
      usage: { inputTokens: 90, outputTokens: 20, totalTokens: 110 },
    }));
    const agent = new Agent(
      { ...config, maxOutputTokens: 32, maxTotalTokens: 100 },
      new ToolRegistry(),
      { chat },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 32 }));
    expect(result.status).toBe("budgetExceeded");
    expect(result.summary).toContain("token budget");
  });

  it("balances every provider tool call when the token budget stops the run", async () => {
    const agent = new Agent(
      { ...config, maxTotalTokens: 10 },
      new ToolRegistry(),
      {
        async chat() {
          return {
            finishReason: "tool-calls",
            message: { role: "assistant", content: "" },
            toolCalls: [
              { toolCallId: "call-1", toolName: "count", args: { count: 1 } },
              { toolCallId: "call-2", toolName: "count", args: { count: 2 } },
            ],
            usage: { totalTokens: 11 },
          };
        },
      },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("budgetExceeded");
    expect(
      result.messages
        .filter((message) => message.role === "tool")
        .map((message) => message.toolCallId),
    ).toEqual(["call-1", "call-2"]);
    expect(result.messages.filter((message) => message.role === "tool")).toEqual([
      expect.objectContaining({ content: expect.stringContaining("token budget") }),
      expect.objectContaining({ content: expect.stringContaining("token budget") }),
    ]);
  });

  it("passes the run signal into tool execution", async () => {
    const execute = vi.fn(
      async (_args: { count: number }, _context?: { signal: AbortSignal }) => "executed",
    );
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute,
    });
    const agent = new Agent(
      { ...config, maxSteps: 1 },
      registry,
      {
        async chat() {
          return {
            finishReason: "tool-calls",
            message: { role: "assistant", content: "" },
            toolCalls: [{ toolCallId: "call-1", toolName: "count", args: { count: 1 } }],
            usage: { totalTokens: 1 },
          };
        },
      },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    await agent.run("go");

    expect(execute).toHaveBeenCalledWith(
      { count: 1 },
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it("uses a conservative token estimate when a provider omits usage", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "x".repeat(400) },
    }));
    const agent = new Agent(
      { ...config, maxTotalTokens: 10 },
      new ToolRegistry(),
      { chat },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("budgetExceeded");
  });

  it("aborts a provider call when the run deadline is exhausted", async () => {
    vi.useFakeTimers();
    try {
      const llmClient: LLMClient = {
        async chat(params) {
          return new Promise((_resolve, reject) => {
            params.signal?.addEventListener("abort", () => {
              reject(new DOMException("aborted", "AbortError"));
            });
          });
        },
      };
      const agent = new Agent(
        { ...config, runTimeoutMs: 1_000 },
        new ToolRegistry(),
        llmClient,
        new CapabilityRegistry({ workspaceRoot: process.cwd() }),
      );

      const result = agent.run("go");
      const rejection = expect(result).rejects.toBeInstanceOf(AgentBudgetExceededError);
      await vi.advanceTimersByTimeAsync(1_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });

  it("stops waiting for a tool that ignores cancellation", async () => {
    vi.useFakeTimers();
    try {
      const registry = new ToolRegistry();
      registry.register({
        name: "count",
        description: "Count",
        parameters: z.object({ count: z.number() }),
        async execute() {
          return new Promise(() => undefined);
        },
      });
      const agent = new Agent(
        { ...config, maxSteps: 1, runTimeoutMs: 1_000 },
        registry,
        {
          async chat() {
            return {
              finishReason: "tool-calls",
              message: { role: "assistant", content: "" },
              toolCalls: [{ toolCallId: "call-1", toolName: "count", args: { count: 1 } }],
              usage: { totalTokens: 1 },
            };
          },
        },
        new CapabilityRegistry({ workspaceRoot: process.cwd() }),
      );

      const run = agent.run("go");
      const rejection = expect(run).rejects.toBeInstanceOf(AgentBudgetExceededError);
      await vi.advanceTimersByTimeAsync(1_000);

      await rejection;
    } finally {
      vi.useRealTimers();
    }
  });
});
