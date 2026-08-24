import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchCapabilities, resetModelsDevCache } from "./models-dev-client.js";

afterEach(() => {
  vi.unstubAllGlobals();
  resetModelsDevCache();
});

describe("models.dev capability boundary", () => {
  it("shares one bounded upstream request across concurrent callers", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            provider: {
              id: "provider",
              models: {
                model: {
                  tool_call: true,
                  modalities: { input: ["text", "image"] },
                  limit: { context: 128_000, output: 4096 },
                },
              },
            },
          }),
        ),
    );
    vi.stubGlobal("fetch", fetchMock);

    const [first, second] = await Promise.all([
      fetchCapabilities("provider", "model", "provider/model"),
      fetchCapabilities("provider", "model", "provider/model"),
    ]);

    expect(first).toEqual({
      chat: true,
      tools: true,
      vision: true,
      streaming: true,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 4096,
      contextWindowTokens: 128_000,
    });
    expect(second).toEqual(first);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does not retry an invalid successful response", async () => {
    const fetchMock = vi.fn(async () => new Response(JSON.stringify({ model: "invalid" })));
    vi.stubGlobal("fetch", fetchMock);

    await expect(fetchCapabilities("provider", "model", "model")).resolves.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
