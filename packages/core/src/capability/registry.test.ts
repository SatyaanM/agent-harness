import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { ProviderRegistry } from "../provider-registry.js";
import { resetModelsDevCache } from "./models-dev-client.js";
import { CapabilityRegistry } from "./registry.js";

const tempDirs: string[] = [];

beforeEach(() => {
  resetModelsDevCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetModelsDevCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CapabilityRegistry manual overrides", () => {
  it("resolves opaque slash model IDs through the configured provider before live probing", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    process.env.ANTHROPIC_PROBE_KEY = "probe-secret";
    const config: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "vendor/model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "anthropic-live",
          displayName: "Anthropic Live",
          protocol: "anthropic",
          baseUrl: "https://anthropic.example/v1",
          apiKeyEnv: "ANTHROPIC_PROBE_KEY",
          supportedModels: ["vendor/model"],
          enabled: true,
          priority: 0,
        },
      ],
    };
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url === "https://models.dev/api.json") return new Response(null, { status: 404 });
      return new Response(null, { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);
    const registry = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(config),
    });

    const capabilities = await registry.lookupModel("vendor/model", "anthropic-live", "vercel-ai");

    expect(capabilities).toMatchObject({ chat: true, tools: true, vision: true, streaming: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://anthropic.example/v1/messages",
      expect.objectContaining({
        headers: expect.objectContaining({
          "anthropic-version": "2023-06-01",
          "x-api-key": "probe-secret",
        }),
        body: expect.stringContaining('"model":"vendor/model"'),
      }),
    );
    delete process.env.ANTHROPIC_PROBE_KEY;
  });

  it("uses conservative capabilities when a configured live probe cannot establish chat", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    process.env.PROBE_KEY = "probe-secret";
    const config: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "vendor/model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "unavailable",
          displayName: "Unavailable",
          protocol: "openai",
          baseUrl: "https://unavailable.example/v1",
          apiKeyEnv: "PROBE_KEY",
          enabled: true,
          priority: 0,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input) === "https://models.dev/api.json"
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 503 }),
      ),
    );
    const registry = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(config),
    });

    await expect(registry.lookupModel("vendor/model", "unavailable", "vercel-ai")).resolves.toEqual(
      {
        chat: false,
        tools: false,
        vision: false,
        streaming: false,
        structuredOutputs: false,
        promptCaching: false,
        reasoning: false,
        maxTokens: 0,
      },
    );
    delete process.env.PROBE_KEY;
  });
  it("preserves an explicit chat override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const registry = new CapabilityRegistry({ workspaceRoot: root });

    const capabilities = await registry.lookup("provider", "model", "sdk", {
      capabilities: {
        chat: false,
        tools: true,
        vision: false,
        streaming: false,
        maxTokens: 100,
      },
    });

    expect(capabilities.chat).toBe(false);
  });

  it("merges partial capability overrides on top of base defaults without wiping unspecified fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const registry = new CapabilityRegistry({ workspaceRoot: root });

    // User only overrides tools to false
    const capabilities = await registry.lookup("unknown-provider", "unknown-model", "unknown-sdk", {
      capabilities: {
        tools: false,
      },
    });

    expect(capabilities.tools).toBe(false);
    // Unspecified fields should retain default values from base matrix
    expect(capabilities.chat).toBe(true);
    expect(capabilities.vision).toBe(true);
  });

  it("does not persist agent-scoped overrides into the shared model cache", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const registry = new CapabilityRegistry({ workspaceRoot: root });

    const restricted = await registry.lookup("provider", "model", "sdk", {
      capabilities: { tools: false, promptCaching: true },
    });
    const unrestricted = await registry.lookup("provider", "model", "sdk");

    expect(restricted.tools).toBe(false);
    expect(restricted.promptCaching).toBe(true);
    expect(unrestricted.tools).toBe(true);
    expect(unrestricted.promptCaching).toBe(false);
  });
});
