import { afterEach, describe, expect, it, vi } from "vitest";
import { createGeminiTTSProvider } from "./gemini.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Gemini TTS provider", () => {
  it("keeps credentials out of the URL and composes caller cancellation", async () => {
    let requestSignal: AbortSignal | undefined;
    const fetchMock = vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      return Response.json({
        candidates: [
          { content: { parts: [{ inlineData: { mimeType: "audio/pcm", data: "AAA=" } }] } },
        ],
      });
    });
    vi.stubGlobal("fetch", fetchMock);
    const controller = new AbortController();

    await createGeminiTTSProvider().synthesize(
      "hello",
      {
        provider: "gemini",
        model: "tts",
        voice: "Gacrux",
        persona: "",
        emotiveTags: false,
        tagStyle: "balanced",
        customTagInstructions: "",
        apiKey: "top-secret",
      },
      controller.signal,
    );

    const [url, init] = fetchMock.mock.calls[0] ?? [];
    expect(String(url)).not.toContain("top-secret");
    expect(new Headers(init?.headers).get("x-goog-api-key")).toBe("top-secret");
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
  });
});
