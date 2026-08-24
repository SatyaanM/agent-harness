import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { resetModelsDevCache } from "../capability/models-dev-client.js";
import { CapabilityRegistry } from "../capability/registry.js";
import type { Config } from "../config.js";
import type { LLMClient } from "../llm/client.js";
import { ProviderRegistry } from "../provider-registry.js";
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

beforeEach(() => {
  resetModelsDevCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
  resetModelsDevCache();
});

describe("Agent tool boundary", () => {
  it("passes the configured provider override to the provider call", async () => {
    const chat = vi.fn().mockResolvedValue({
      message: { role: "assistant", content: "done" },
      finishReason: "stop",
    });
    const capabilityRegistry = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    const lookup = vi.spyOn(capabilityRegistry, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    const agent = new Agent(
      { ...config, provider: "preferred-provider", tools: [], maxSteps: 1 },
      new ToolRegistry(),
      { chat },
      capabilityRegistry,
    );

    await agent.run("go");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({ preferredProviderId: "preferred-provider" }),
    );
    expect(lookup).toHaveBeenCalledWith(
      "preferred-provider",
      "test-model",
      "vercel-ai",
      expect.objectContaining({ provider: "preferred-provider" }),
    );
  });

  it("does not report provider truncation as success", async () => {
    const agent = new Agent(
      config,
      new ToolRegistry(),
      {
        async chat() {
          return {
            finishReason: "length",
            message: { role: "assistant", content: "partial" },
          };
        },
      },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("error");
    expect(result.summary).toContain("length");
    expect(result.messages.at(-1)?.content).toBe("partial");
  });
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

  it("executes tool calls carried on the assistant message", async () => {
    const execute = vi.fn(async () => "executed");
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute,
    });
    let call = 0;
    const agent = new Agent(
      config,
      registry,
      {
        async chat() {
          call += 1;
          return call === 1
            ? {
                finishReason: "tool-calls",
                message: {
                  role: "assistant",
                  content: "",
                  toolCalls: [
                    { toolCallId: "call-message", toolName: "count", args: { count: 1 } },
                  ],
                },
              }
            : { finishReason: "stop", message: { role: "assistant", content: "done" } };
        },
      },
      new CapabilityRegistry({ workspaceRoot: process.cwd() }),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("success");
    expect(execute).toHaveBeenCalledWith({ count: 1 }, expect.any(Object));
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
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute: async () => "counted",
    });
    const agent = new Agent(
      { ...config, maxTotalTokens: 10 },
      tools,
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

describe("Agent streaming", () => {
  function streamingCapabilities(): CapabilityRegistry {
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
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
    return capabilities;
  }

  it("passes the configured provider override to the streaming call", async () => {
    const observedParams: unknown[] = [];
    const agent = new Agent(
      { ...config, provider: "preferred-provider", tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream(params) {
          observedParams.push(params);
          yield { type: "finish" as const, finishReason: "stop" as const };
        },
      },
      streamingCapabilities(),
    );

    await agent.run("go");

    expect(observedParams).toEqual([
      expect.objectContaining({ preferredProviderId: "preferred-provider" }),
    ]);
  });

  it("assembles the same transcript as the blocking pathway", async () => {
    const streamed = new Agent(
      { ...config, tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield { type: "text-delta" as const, text: "byte-" };
          yield { type: "text-delta" as const, text: "exact" };
          yield {
            type: "finish" as const,
            finishReason: "stop" as const,
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          };
        },
      },
      streamingCapabilities(),
    );
    const blocking = new Agent(
      { ...config, tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          return {
            finishReason: "stop" as const,
            message: { role: "assistant" as const, content: "byte-exact" },
            usage: { inputTokens: 1, outputTokens: 2, totalTokens: 3 },
          };
        },
      },
      (() => {
        const capabilities = streamingCapabilities();
        vi.mocked(capabilities.lookup).mockResolvedValueOnce({
          chat: true,
          tools: true,
          vision: true,
          streaming: false,
          structuredOutputs: true,
          promptCaching: false,
          reasoning: false,
          maxTokens: 0,
        });
        return capabilities;
      })(),
    );

    const [streamedResult, blockingResult] = await Promise.all([
      streamed.run("go"),
      blocking.run("go"),
    ]);

    expect(streamedResult.messages).toEqual(blockingResult.messages);
  });

  it("assembles streamed reasoning into the durable assistant transcript", async () => {
    const agent = new Agent(
      { ...config, tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield { type: "reasoning-delta" as const, reasoning: "private " };
          yield { type: "reasoning-delta" as const, reasoning: "thought" };
          yield { type: "text-delta" as const, text: "answer" };
          yield { type: "finish" as const, finishReason: "stop" as const };
        },
      },
      streamingCapabilities(),
    );

    const result = await agent.run("go");
    expect(result.messages.at(-1)).toEqual({
      role: "assistant",
      content: "answer",
      reasoning: "private thought",
    });
  });

  it("rejects cumulative streamed text before emitting excess output", async () => {
    const onEvent = vi.fn();
    const agent = new Agent(
      { ...config, tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          for (let index = 0; index < 20; index++) {
            yield { type: "text-delta" as const, text: "a".repeat(50_000) };
          }
          yield { type: "text-delta" as const, text: "b" };
          yield { type: "finish" as const, finishReason: "stop" as const };
        },
      },
      streamingCapabilities(),
      onEvent,
    );

    await expect(agent.run("go")).rejects.toThrow("streamed text limit");
    expect(onEvent).toHaveBeenCalledTimes(21); // 20 text deltas plus stream metrics
    expect(onEvent).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: "text-delta", text: expect.stringMatching(/^b/) }),
    );
  });

  it("rejects oversized streamed tool arguments before executing the tool", async () => {
    const execute = vi.fn(async () => "must not execute");
    const onEvent = vi.fn();
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ value: z.string() }),
      execute,
    });
    const agent = new Agent(
      config,
      tools,
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield {
            type: "tool-call-delta" as const,
            toolCall: { id: "call-1", name: "count", argumentsDelta: '{"value":"' },
          };
          for (let index = 0; index < 20; index++) {
            yield {
              type: "tool-call-delta" as const,
              toolCall: { id: "call-1", name: "count", argumentsDelta: "x".repeat(50_000) },
            };
          }
          yield { type: "finish" as const, finishReason: "tool-calls" as const };
        },
      },
      streamingCapabilities(),
      onEvent,
    );

    await expect(agent.run("go")).rejects.toThrow("tool argument limit");
    expect(execute).not.toHaveBeenCalled();
    expect(onEvent.mock.calls.filter(([event]) => event.type === "tool-call-delta")).toHaveLength(
      20,
    ); // start fragment plus 19 accepted chunks; the excess chunk is never emitted
  });

  it("rejects excessive distinct streamed tool calls before emitting the excess call", async () => {
    const onEvent = vi.fn();
    const agent = new Agent(
      { ...config, maxToolCalls: 2 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          for (let index = 1; index <= 3; index++) {
            yield {
              type: "tool-call-delta" as const,
              toolCall: { id: `call-${index}`, name: "count", argumentsDelta: "{}" },
            };
          }
          yield { type: "finish" as const, finishReason: "tool-calls" as const };
        },
      },
      streamingCapabilities(),
      onEvent,
    );

    await expect(agent.run("go")).rejects.toThrow("tool-call count limit");
    expect(onEvent.mock.calls.filter(([event]) => event.type === "tool-call-delta")).toHaveLength(
      2,
    );
  });

  it("counts UTF-8 bytes before emitting a multibyte stream delta", async () => {
    const onEvent = vi.fn();
    const agent = new Agent(
      { ...config, tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield { type: "text-delta" as const, text: "😀".repeat(20_000) };
          yield { type: "finish" as const, finishReason: "stop" as const };
        },
      },
      streamingCapabilities(),
      onEvent,
    );

    await expect(agent.run("go")).rejects.toThrow("delta byte limit");
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "text-delta" }));
  });

  it.each([
    ["tool call id", { id: "x".repeat(257), name: "count" }],
    ["tool name", { id: "call-1", name: "😀".repeat(33) }],
  ])("rejects an oversized streamed %s before retaining or emitting it", async (label, fields) => {
    const onEvent = vi.fn();
    const agent = new Agent(
      config,
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield {
            type: "tool-call-delta" as const,
            toolCall: { ...fields, argumentsDelta: "{}" },
          };
          yield { type: "finish" as const, finishReason: "tool-calls" as const };
        },
      },
      streamingCapabilities(),
      onEvent,
    );

    await expect(agent.run("go")).rejects.toThrow(`${label} limit`);
    expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: "tool-call-delta" }));
  });

  it("rejects excess cumulative delta bytes before emitting or executing them", async () => {
    const execute = vi.fn(async () => "must not execute");
    const onEvent = vi.fn();
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ value: z.string() }),
      execute,
    });
    const agent = new Agent(
      { ...config, maxToolCalls: 64 },
      tools,
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          for (let toolIndex = 0; toolIndex < 10; toolIndex++) {
            for (let chunkIndex = 0; chunkIndex < 19; chunkIndex++) {
              yield {
                type: "tool-call-delta" as const,
                toolCall: {
                  id: `c${toolIndex}`,
                  name: "count",
                  argumentsDelta: "x".repeat(50_000),
                },
              };
            }
          }
          for (let chunkIndex = 0; chunkIndex < 9; chunkIndex++) {
            yield {
              type: "tool-call-delta" as const,
              toolCall: { id: "excess", name: "count", argumentsDelta: "x".repeat(50_000) },
            };
          }
          yield {
            type: "tool-call-delta" as const,
            toolCall: { id: "excess", name: "count", argumentsDelta: "y".repeat(50_000) },
          };
          yield { type: "finish" as const, finishReason: "tool-calls" as const };
        },
      },
      streamingCapabilities(),
      onEvent,
    );

    await expect(agent.run("go")).rejects.toThrow("total delta byte limit");
    expect(execute).not.toHaveBeenCalled();
    expect(
      onEvent.mock.calls.some(
        ([event]) =>
          event.type === "tool-call-delta" && event.toolCall.argumentsDelta.startsWith("y"),
      ),
    ).toBe(false);
  });

  it("rejects malformed streamed tool JSON before executing the tool", async () => {
    const execute = vi.fn(async () => "should not execute");
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute,
    });
    const agent = new Agent(
      config,
      tools,
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield {
            type: "tool-call-delta" as const,
            toolCall: { id: "call-1", name: "count", argumentsDelta: "{bad" },
          };
          yield { type: "finish" as const, finishReason: "tool-calls" as const };
        },
      },
      streamingCapabilities(),
    );

    await expect(agent.run("go")).rejects.toThrow("Failed to parse tool call arguments");
    expect(execute).not.toHaveBeenCalled();
  });

  it("requires a terminal finish event from every streaming client", async () => {
    const agent = new Agent(
      { ...config, tools: [] },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        async *chatStream() {
          yield { type: "text-delta" as const, text: "partial" };
        },
      },
      streamingCapabilities(),
    );

    await expect(agent.run("go")).rejects.toThrow("without a terminal finish");
  });

  it("cancels an iterator whose next call ignores the run signal and closes it", async () => {
    const controller = new AbortController();
    const next = vi.fn(() => new Promise<IteratorResult<never>>(() => undefined));
    const close = vi.fn(async () => ({ done: true as const, value: undefined }));
    const agent = new Agent(
      { ...config, tools: [], maxSteps: 1 },
      new ToolRegistry(),
      {
        async chat() {
          throw new Error("blocking pathway must not run");
        },
        chatStream() {
          return {
            [Symbol.asyncIterator]() {
              return { next, return: close };
            },
          };
        },
      },
      streamingCapabilities(),
    );

    const run = agent.run("go", [], controller.signal);
    await vi.waitFor(() => expect(next).toHaveBeenCalledOnce());
    controller.abort();

    await expect(run).rejects.toBeInstanceOf(AgentCancelledError);
    expect(close).toHaveBeenCalledOnce();
  });

  it.each([
    ["text delta", { type: "text-delta" as const, text: "late" }],
    [
      "tool delta",
      {
        type: "tool-call-delta" as const,
        toolCall: { id: "late-call", name: "count", argumentsDelta: "{}" },
      },
    ],
    ["duplicate finish", { type: "finish" as const, finishReason: "stop" as const }],
  ])(
    "rejects a %s after the terminal finish without emitting or persisting it",
    async (_name, late) => {
      const onEvent = vi.fn();
      const agent = new Agent(
        { ...config, tools: [], maxSteps: 1 },
        new ToolRegistry(),
        {
          async chat() {
            throw new Error("blocking pathway must not run");
          },
          async *chatStream() {
            yield { type: "finish" as const, finishReason: "stop" as const };
            yield late;
          },
        },
        streamingCapabilities(),
        onEvent,
      );

      await expect(agent.run("go")).rejects.toThrow("after terminal finish");
      expect(onEvent).not.toHaveBeenCalledWith(expect.objectContaining({ type: late.type }));
    },
  );
});

describe("Agent Capability Enforcement", () => {
  it("accepts one pre-resolved matrix and skips a duplicate lookup", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "done" },
    }));
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    const lookup = vi.spyOn(capabilities, "lookup");
    const matrix = {
      chat: true,
      tools: false,
      vision: false,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 256,
    } as const;

    await new Agent(config, new ToolRegistry(), { chat }, capabilities).run(
      "go",
      [],
      undefined,
      matrix,
    );

    expect(lookup).not.toHaveBeenCalled();
    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 256 }));
  });

  it("strips tools when tools capability is false", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "no tools sent" },
    }));
    const registry = new ToolRegistry();
    registry.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute: async () => "ok",
    });

    const capabilityRegistry = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(capabilityRegistry, "lookup").mockResolvedValue({
      chat: true,
      tools: false,
      vision: true,
      streaming: false,
      structuredOutputs: true,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });

    const agent = new Agent(config, registry, { chat }, capabilityRegistry);
    await agent.run("go");

    expect(chat).toHaveBeenCalledWith(expect.not.objectContaining({ tools: expect.anything() }));
  });

  it("strips images when vision capability is false", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "no images" },
    }));

    const capabilityRegistry = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(capabilityRegistry, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: false,
      streaming: false,
      structuredOutputs: true,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });

    const agent = new Agent(config, new ToolRegistry(), { chat }, capabilityRegistry);
    await agent.run("Here is an image: ![alt](http://example.com/img.png) and text.");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({
            content: "Here is an image: [Image omitted due to model capability] and text.",
          }),
        ]),
      }),
    );
  });

  it("looks up capabilities once for every run, not once for every step", async () => {
    const chat = vi
      .fn<LLMClient["chat"]>()
      .mockResolvedValueOnce({
        finishReason: "tool-calls",
        message: { role: "assistant", content: "", toolCalls: [] },
        toolCalls: [{ toolCallId: "call-1", toolName: "count", args: { count: 1 } }],
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        message: { role: "assistant", content: "done" },
      });
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute: async () => "counted",
    });
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    const lookup = vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });

    const agent = new Agent(config, tools, { chat }, capabilities);
    expect((await agent.run("go")).status).toBe("success");

    expect(chat).toHaveBeenCalledTimes(2);
    expect(lookup).toHaveBeenCalledTimes(1);
  });

  it("sanitizes disabled tool calls, diagnoses them, and asks for a tool-free response", async () => {
    const hallucinatedCall = { toolCallId: "call-1", toolName: "count", args: { count: 1 } };
    const chat = vi
      .fn<LLMClient["chat"]>()
      .mockResolvedValueOnce({
        finishReason: "tool-calls",
        message: { role: "assistant", content: "trying", toolCalls: [hallucinatedCall] },
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        message: { role: "assistant", content: "tool-free answer" },
      });
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: false,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    const events: Parameters<NonNullable<ConstructorParameters<typeof Agent>[4]>>[0][] = [];
    const execute = vi.fn(async () => "must not run");
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute,
    });
    const agent = new Agent(config, tools, { chat }, capabilities, (event) => events.push(event));

    const result = await agent.run("go");

    expect(result.status).toBe("success");
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: "capability-mismatch",
      detail: "Model returned 1 tool call(s) but tools capability is disabled",
    });
    expect(result.messages).toEqual(
      expect.arrayContaining([
        { role: "assistant", content: "trying" },
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("Tool calls are disabled"),
        }),
      ]),
    );
    expect(chat).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        messages: expect.not.arrayContaining([
          expect.objectContaining({ toolCalls: expect.anything() }),
        ]),
      }),
    );
  });

  it("denies calls outside the eligible tool map even when the registry contains them", async () => {
    const deniedCalls = [
      { toolCallId: "call-delegate", toolName: "delegate", args: {} },
      { toolCallId: "call-hitl", toolName: "approve", args: {} },
      { toolCallId: "call-unconfigured", toolName: "hidden", args: {} },
    ];
    const chat = vi
      .fn<LLMClient["chat"]>()
      .mockResolvedValueOnce({
        finishReason: "tool-calls",
        message: { role: "assistant", content: "trying", toolCalls: deniedCalls },
      })
      .mockResolvedValueOnce({
        finishReason: "stop",
        message: { role: "assistant", content: "safe answer" },
      });
    const execute = vi.fn(async () => "must not run");
    const tools = new ToolRegistry();
    for (const [name, requiresHITL] of [
      ["delegate", false],
      ["approve", true],
      ["hidden", false],
    ] as const) {
      tools.register({
        name,
        description: name,
        parameters: z.object({}),
        requiresHITL,
        execute,
      });
    }
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    const events: Parameters<NonNullable<ConstructorParameters<typeof Agent>[4]>>[0][] = [];
    const agent = new Agent(
      { ...config, tools: [], maxSteps: 2 },
      tools,
      { chat },
      capabilities,
      (event) => events.push(event),
    );

    const result = await agent.run("go");

    expect(result.status).toBe("success");
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual(
      expect.objectContaining({
        type: "capability-mismatch",
        detail: expect.stringContaining("delegate, approve, hidden"),
      }),
    );
    expect(result.messages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: "system",
          content: expect.stringContaining("not eligible"),
        }),
      ]),
    );
  });

  it("applies model output and HITL reasoning bounds while forwarding prompt caching", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "bounded" },
    }));
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      requiresHITL: true,
      execute: async () => "counted",
    });
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(capabilities, "lookup").mockResolvedValue({
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: true,
      reasoning: false,
      maxTokens: 512,
    });

    await new Agent({ ...config, maxOutputTokens: 1_024 }, tools, { chat }, capabilities).run("go");

    expect(chat).toHaveBeenCalledWith(
      expect.objectContaining({
        maxOutputTokens: 512,
        promptCaching: true,
      }),
    );
    expect(chat).toHaveBeenCalledWith(expect.not.objectContaining({ tools: expect.anything() }));
  });

  it("uses the minimum positive fallback output limit when another target is unknown", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "bounded" },
    }));
    const root = process.cwd();
    const providerConfig: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "test-model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "known",
          displayName: "Known",
          protocol: "openai",
          baseUrl: "https://known.example/v1",
          apiKeyEnv: "KNOWN_KEY",
          enabled: true,
          priority: 0,
        },
        {
          id: "unknown",
          displayName: "Unknown",
          protocol: "anthropic",
          baseUrl: "https://unknown.example/v1",
          apiKeyEnv: "UNKNOWN_KEY",
          enabled: true,
          priority: 1,
        },
      ],
    };
    const capabilities = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(providerConfig),
    });
    vi.spyOn(capabilities, "lookup")
      .mockResolvedValueOnce({
        chat: true,
        tools: false,
        vision: false,
        streaming: false,
        structuredOutputs: false,
        promptCaching: false,
        reasoning: false,
        maxTokens: 1_024,
      })
      .mockResolvedValueOnce({
        chat: true,
        tools: false,
        vision: false,
        streaming: false,
        structuredOutputs: false,
        promptCaching: false,
        reasoning: false,
        maxTokens: 0,
      });

    await new Agent({ ...config, tools: [] }, new ToolRegistry(), { chat }, capabilities).run("go");

    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 1_024 }));
  });

  it("uses the 4096 default output limit only when every fallback limit is unknown", async () => {
    const chat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "defaulted" },
    }));
    const capabilities = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(capabilities, "lookupModel").mockResolvedValue({
      chat: true,
      tools: false,
      vision: false,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });

    await new Agent({ ...config, tools: [] }, new ToolRegistry(), { chat }, capabilities).run("go");

    expect(chat).toHaveBeenCalledWith(expect.objectContaining({ maxOutputTokens: 4_096 }));
  });

  it("adds schema adherence guidance only when native structured outputs are unavailable", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "count",
      description: "Count",
      parameters: z.object({ count: z.number() }),
      execute: async () => "counted",
    });
    const matrix = {
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: true,
      maxTokens: 0,
    } as const;
    const withoutNative = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(withoutNative, "lookup").mockResolvedValue(matrix);
    const fallbackChat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "done" },
    }));
    await new Agent(config, tools, { chat: fallbackChat }, withoutNative).run("go");

    const withNative = new CapabilityRegistry({ workspaceRoot: process.cwd() });
    vi.spyOn(withNative, "lookup").mockResolvedValue({ ...matrix, structuredOutputs: true });
    const nativeChat = vi.fn<LLMClient["chat"]>(async () => ({
      finishReason: "stop",
      message: { role: "assistant", content: "done" },
    }));
    await new Agent(config, tools, { chat: nativeChat }, withNative).run("go");

    expect(fallbackChat).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.stringContaining("JSON schemas") }),
    );
    expect(nativeChat).toHaveBeenCalledWith(
      expect.objectContaining({ system: expect.not.stringContaining("JSON schemas") }),
    );
  });
});
