import { beforeEach, describe, expect, it, vi } from "vitest";

beforeEach(() => {
  localStorage.clear();
  vi.resetModules();
});

describe("TTS settings persistence", () => {
  it("persists only schema-owned settings and restores the selected voice", async () => {
    const firstModule = await import("./tts-store");

    firstModule.useTTSStore.getState().setVoice("Zephyr");

    expect(localStorage.getItem("tts-settings")).toBe(
      JSON.stringify({
        enabled: false,
        voice: "Zephyr",
        persona: "",
        emotiveTags: true,
        tagStyle: "balanced",
        customTagInstructions: "",
      }),
    );

    vi.resetModules();
    const reloadedModule = await import("./tts-store");

    expect(reloadedModule.useTTSStore.getState().voice).toBe("Zephyr");
  });
});
