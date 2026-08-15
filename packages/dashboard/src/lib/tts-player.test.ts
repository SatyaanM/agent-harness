import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.resetModules();
});

describe("TTS player API boundary", () => {
  it("uses NEXT_PUBLIC_API_URL instead of a hard-coded localhost origin", async () => {
    vi.stubEnv("NEXT_PUBLIC_API_URL", "https://harness.example");
    const fetchMock = vi.fn(async () =>
      Response.json({ error: "expected failure" }, { status: 502 }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const { createTTSPlayer } = await import("./tts-player");

    await expect(createTTSPlayer().play("hello")).rejects.toThrow("expected failure");
    expect(fetchMock).toHaveBeenCalledWith(
      "https://harness.example/api/tts",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
