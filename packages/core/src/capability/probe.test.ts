import { afterEach, describe, expect, it, vi } from "vitest";
import { probeCapabilities } from "./probe.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("probeCapabilities", () => {
  it("runs admission immediately before every provider network request", async () => {
    const beforeRequest = vi.fn(() => true);
    const fetchMock = vi.fn(async () => new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await probeCapabilities(
      {
        baseUrl: "https://provider.example/v1",
        apiKey: "secret",
        model: "model",
        maxRetries: 0,
      },
      { beforeRequest },
    );

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(beforeRequest).toHaveBeenCalledTimes(4);
    expect(beforeRequest).toHaveBeenCalledWith(expect.any(Number));
  });

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
