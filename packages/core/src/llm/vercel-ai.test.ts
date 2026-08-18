import { beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";
import type { Config } from "../config.js";
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
}));

vi.mock("ai", () => ({
  generateText: mocks.generateText,
  tool: (definition: unknown) => definition,
}));
vi.mock("@ai-sdk/openai", () => ({
  createOpenAI: () => ({ chat: () => mocks.model }),
}));
vi.mock("@ai-sdk/anthropic", () => ({
  createAnthropic: () => () => mocks.model,
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
  mocks.generateText.mockReset();
  mocks.generateText.mockResolvedValue({
    text: "done",
    finishReason: "stop",
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  });
});

describe("Vercel AI adapter", () => {
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
});
