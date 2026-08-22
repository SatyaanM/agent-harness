import { afterEach, describe, expect, it, vi } from "vitest";
import { probeCapabilities } from "./probe.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeCapabilities", () => {
  it("rejects invalid probe configuration before network access", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      probeCapabilities({
        baseUrl: "file:///private/provider",
        apiKey: "secret",
        model: "model",
      }),
    ).rejects.toThrow("capability probe options");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("cancels unused response bodies for every status-only probe", async () => {
    const cancel = vi.fn(async () => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => ({ ok: true, body: { cancel } })),
    );

    await expect(
      probeCapabilities({
        baseUrl: "https://provider.example/v1/",
        apiKey: "secret",
        model: "model",
        maxRetries: 0,
      }),
    ).resolves.toEqual({
      chat: true,
      tools: true,
      vision: true,
      streaming: true,
      maxTokens: 0,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
    });
    expect(cancel).toHaveBeenCalledTimes(4);
  });
});
