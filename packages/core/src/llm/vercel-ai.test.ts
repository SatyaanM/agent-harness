import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { createVercelAILLMClient } from "./vercel-ai.js";

const mocks = vi.hoisted(() => ({
  generateText: vi.fn(async () => ({
    text: "done",
    finishReason: "stop",
    toolCalls: [],
    usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
  })),
  model: { modelId: "test-model" },
}));

vi.mock("ai", () => ({ generateText: mocks.generateText }));
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
  mocks.generateText.mockClear();
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
});
