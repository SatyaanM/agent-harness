import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Config } from "../config.js";
import { ProviderRuntimeState } from "../provider-runtime.js";
import { createVercelAILLMClient } from "./vercel-ai.js";

interface GenerateTextResultMock {
  text: string;
  reasoning?: string;
  finishReason: string;
  toolCalls: Array<{ toolCallId: string; toolName: string; input: Record<string, unknown> }>;
  usage: { inputTokens: number; outputTokens: number; totalTokens: number };
}

const mocks = vi.hoisted(() => ({
  generateText: vi.fn<() => Promise<GenerateTextResultMock>>(async () => ({
    text: "done",
    finishReason: "stop",
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  })),
  model: { modelId: "test-model" },
  openAIChat: vi.fn(() => ({ modelId: "openai-model" })),
  createOpenAI: vi.fn(() => ({ chat: mocks.openAIChat })),
  createAnthropic: vi.fn(() => () => ({ modelId: "anthropic-model" })),
}));

vi.mock("ai", async (importOriginal) => {
  const actual = await importOriginal<typeof import("ai")>();
  return {
    ...actual,
    generateText: mocks.generateText,
    tool: (definition: unknown) => definition,
  };
});
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: mocks.createOpenAI,
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: mocks.createAnthropic,
}));

const config: Config = {
  ROOT: process.cwd(),
  INBOX_ROOT: process.cwd(),
  SESSIONS_DIR: process.cwd(),
  AGENTS_DIR: process.cwd(),
  PROVIDER_ENDPOINT: "https://provider.example/v1",
  API_KEY_ENV: "TEST_API_KEY",
  DEFAULT_MODEL: "test-model",
  MAX_CONCURRENT_AGENTS: 1,
};

beforeEach(() => {
  mocks.createOpenAI.mockClear();
  mocks.openAIChat.mockClear();
  mocks.createAnthropic.mockClear();
  mocks.generateText.mockReset();
  mocks.generateText.mockResolvedValue({
    text: "done",
    finishReason: "stop",
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
});

describe("Vercel AI adapter", () => {
  it("includes serialized tool parameter schemas in token admission", async () => {
    const limitedConfig: Config = {
      ...config,
      PROVIDERS: [
        {
          id: "schema-limited",
          displayName: "Schema Limited",
          protocol: "openai",
          baseUrl: "https://limited.example/v1",
          apiKeyEnv: "TEST_API_KEY",
          rateLimit: { tokensPerMinute: 100 },
          enabled: true,
          priority: 0,
        },
      ],
    };
    const client = createVercelAILLMClient(limitedConfig);

    await expect(
      client.chat({
        messages: [{ role: "user", content: "use the tool" }],
        model: "test-model",
        maxOutputTokens: 1,
        tools: [
          {
            name: "largeSchema",
            description: "A tool",
            parameters: z.object({
              input: z.string().describe("x".repeat(2_000)),
            }),
          },
        ],
      }),
    ).rejects.toThrow("token");
    expect(mocks.generateText).not.toHaveBeenCalled();
  });

  it("uses supported Anthropic providerOptions and a system-message cache breakpoint", async () => {
    const anthropicConfig: Config = {
      ...config,
      PROVIDERS: [
        {
          id: "anthropic",
          displayName: "Anthropic",
          protocol: "anthropic",
          baseUrl: "https://anthropic.example/v1",
          apiKeyEnv: "TEST_API_KEY",
          enabled: true,
          priority: 0,
        },
      ],
    };

    await createVercelAILLMClient(anthropicConfig).chat({
      messages: [{ role: "user", content: "hello" }],
      system: "stable instructions",
      model: "vendor/model",
      promptCaching: true,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        instructions: {
          role: "system",
          content: "stable instructions",
          providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
        },
        providerOptions: { anthropic: { cacheControl: { type: "ephemeral" } } },
      }),
    );
    expect(mocks.generateText).not.toHaveBeenCalledWith(
      expect.objectContaining({ experimental_providerMetadata: expect.anything() }),
    );
  });

  it("preserves configured slash-containing model IDs and shares rate admission", async () => {
    const limitedConfig: Config = {
      ...config,
      PROVIDERS: [
        {
          id: "limited",
          displayName: "Limited",
          protocol: "openai",
          baseUrl: "https://limited.example/v1",
          apiKeyEnv: "TEST_API_KEY",
          rateLimit: { requestsPerMinute: 1 },
          enabled: true,
          priority: 0,
        },
      ],
    };
    const shared = new ProviderRuntimeState(limitedConfig);
    const first = createVercelAILLMClient(limitedConfig, shared);
    const second = createVercelAILLMClient(limitedConfig, shared);

    await first.chat({ messages: [{ role: "user", content: "hello" }], model: "vendor/model" });
    expect(mocks.openAIChat).toHaveBeenCalledWith("vendor/model");
    await expect(
      second.chat({ messages: [{ role: "user", content: "again" }], model: "vendor/model" }),
    ).rejects.toThrow("rate limit");
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
  it("passes cancellation through the AI SDK abortSignal option", async () => {
    const controller = new AbortController();
    const client = createVercelAILLMClient(config);

    await client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
      signal: controller.signal,
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({ abortSignal: controller.signal }),
    );
    expect(mocks.generateText).not.toHaveBeenCalledWith(
      expect.objectContaining({ signal: controller.signal }),
    );
  });

  it("keeps reasoning separate when the provider returns no answer text", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: "",
      reasoning: "private reasoning",
      finishReason: "stop",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const client = createVercelAILLMClient(config);

    const result = await client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
    });

    expect(result.message.content).toBe("");
    expect(result.message.reasoning).toBe("private reasoning");
  });

  it("preserves non-success provider finish reasons", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: "partial",
      finishReason: "length",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });
    const client = createVercelAILLMClient(config);

    const result = await client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
    });

    expect(result.finishReason).toBe("length");
  });

  it("passes system instructions and tool parameters correctly to generateText", async () => {
    mocks.generateText.mockResolvedValueOnce({
      text: "calling tool",
      finishReason: "tool-calls",
      toolCalls: [
        {
          toolCallId: "call-1",
          toolName: "testTool",
          input: { query: "hello" },
        },
      ],
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
    });
    const client = createVercelAILLMClient(config);

    const result = await client.chat({
      system: "You are a helpful assistant.",
      messages: [{ role: "user", content: "search for me" }],
      tools: [
        {
          name: "testTool",
          description: "Search tool",
          parameters: z.object({ query: z.string() }),
        },
      ],
      model: "test-model",
    });

    expect(mocks.generateText).toHaveBeenCalledWith(
      expect.objectContaining({
        system: "You are a helpful assistant.",
        tools: {
          testTool: expect.objectContaining({
            description: "Search tool",
          }),
        },
      }),
    );

    expect(result.toolCalls).toEqual([
      {
        toolCallId: "call-1",
        toolName: "testTool",
        args: { query: "hello" },
      },
    ]);
  });

  it("falls back to secondary provider on 429 error and implements circuit breaker", async () => {
    vi.useFakeTimers();
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const multiConfig: Config = {
      ...config,
      PROVIDERS: [
        {
          id: "primary",
          displayName: "Primary",
          protocol: "openai",
          baseUrl: "https://primary.example",
          apiKeyEnv: "TEST_API_KEY",
          enabled: true,
          priority: 0,
        },
        {
          id: "secondary",
          displayName: "Secondary",
          protocol: "anthropic",
          baseUrl: "https://secondary.example",
          apiKeyEnv: "TEST_API_KEY",
          enabled: true,
          priority: 1,
        },
      ],
    };

    // First call throws 429, second call succeeds
    mocks.generateText.mockRejectedValueOnce(
      Object.assign(new Error("Rate limit"), { statusCode: 429, name: "APICallError" }),
    );
    mocks.generateText.mockResolvedValueOnce({
      text: "fallback success",
      finishReason: "stop",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const client = createVercelAILLMClient(multiConfig);

    const chatPromise = client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
    });

    await vi.runAllTimersAsync();

    const result = await chatPromise;
    expect(result.message.content).toBe("fallback success");
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    expect(warning).toHaveBeenCalledWith(expect.stringContaining("providerId=primary"));

    // Verify circuit breaker prevents primary on immediate next call
    mocks.generateText.mockResolvedValueOnce({
      text: "secondary again",
      finishReason: "stop",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    const chatPromise2 = client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
    });
    await vi.runAllTimersAsync();
    const result2 = await chatPromise2;
    expect(result2.message.content).toBe("secondary again");
    expect(mocks.generateText).toHaveBeenCalledTimes(3);

    vi.useRealTimers();
  });

  it("routes through an eligible preferred provider before higher-priority providers", async () => {
    const client = createVercelAILLMClient(multiProviderConfig());
    mocks.generateText.mockResolvedValueOnce({
      text: "preferred success",
      finishReason: "stop",
      toolCalls: [],
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
    });

    await client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
      preferredProviderId: "secondary",
    });

    expect(mocks.createAnthropic).toHaveBeenCalledWith(
      expect.objectContaining({ baseURL: "https://secondary.example" }),
    );
    expect(mocks.createOpenAI).not.toHaveBeenCalled();
  });

  it("does not retry a non-transient provider failure", async () => {
    const client = createVercelAILLMClient(multiProviderConfig());
    const unauthorized = Object.assign(new Error("Unauthorized"), {
      name: "APICallError",
      statusCode: 401,
    });
    mocks.generateText.mockRejectedValueOnce(unauthorized);

    await expect(
      client.chat({ messages: [{ role: "user", content: "hello" }], model: "test-model" }),
    ).rejects.toBe(unauthorized);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });

  it("falls back after a 5xx provider failure", async () => {
    vi.useFakeTimers();
    vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const client = createVercelAILLMClient(multiProviderConfig());
    mocks.generateText
      .mockRejectedValueOnce(Object.assign(new Error("Unavailable"), { statusCode: 503 }))
      .mockResolvedValueOnce({
        text: "recovered",
        finishReason: "stop",
        toolCalls: [],
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      });

    const completion = client.chat({
      messages: [{ role: "user", content: "hello" }],
      model: "test-model",
    });
    await vi.runAllTimersAsync();

    await expect(completion).resolves.toEqual(
      expect.objectContaining({ message: expect.objectContaining({ content: "recovered" }) }),
    );
    expect(mocks.generateText).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });

  it("preserves aborts without retrying another provider", async () => {
    const client = createVercelAILLMClient(multiProviderConfig());
    const controller = new AbortController();
    const aborted = new DOMException("Cancelled", "AbortError");
    mocks.generateText.mockImplementationOnce(async () => {
      controller.abort(aborted);
      throw aborted;
    });

    await expect(
      client.chat({
        messages: [{ role: "user", content: "hello" }],
        model: "test-model",
        signal: controller.signal,
      }),
    ).rejects.toBe(aborted);
    expect(mocks.generateText).toHaveBeenCalledTimes(1);
  });
});

function multiProviderConfig(): Config {
  return {
    ...config,
    PROVIDERS: [
      {
        id: "primary",
        displayName: "Primary",
        protocol: "openai",
        baseUrl: "https://primary.example",
        apiKeyEnv: "TEST_API_KEY",
        enabled: true,
        priority: 0,
      },
      {
        id: "secondary",
        displayName: "Secondary",
        protocol: "anthropic",
        baseUrl: "https://secondary.example",
        apiKeyEnv: "TEST_API_KEY",
        enabled: true,
        priority: 1,
      },
    ],
  };
}
