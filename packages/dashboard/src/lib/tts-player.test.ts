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

  it("aborts an older request before starting replacement playback", async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementationOnce(async (_input, init) => {
        if (!(init?.signal instanceof AbortSignal)) throw new Error("Expected abort signal");
        firstSignal = init.signal;
        return new Promise<Response>((_resolve, reject) => {
          init.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("aborted", "AbortError")),
            { once: true },
          );
        });
      })
      .mockResolvedValueOnce(Response.json({ error: "replacement stopped" }, { status: 502 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createTTSPlayer } = await import("./tts-player");
    const player = createTTSPlayer();

    const first = player.play("first").catch(() => undefined);
    await vi.waitFor(() => expect(firstSignal).toBeDefined());
    const second = player.play("second").catch(() => undefined);

    expect(firstSignal?.aborted).toBe(true);
    await Promise.all([first, second]);
  });
});
