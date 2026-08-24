import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Config } from "../config.js";
import { ProviderRegistry } from "../provider-registry.js";
import { ProviderRuntimeState } from "../provider-runtime.js";
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
  it("intersects capabilities across every eligible fallback target", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const config: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "shared-model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "full",
          displayName: "Full",
          protocol: "openai",
          baseUrl: "https://full.example/v1",
          apiKeyEnv: "FULL_KEY",
          supportedModels: ["shared-model"],
          enabled: true,
          priority: 0,
        },
        {
          id: "limited",
          displayName: "Limited",
          protocol: "anthropic",
          baseUrl: "https://limited.example/v1",
          apiKeyEnv: "LIMITED_KEY",
          supportedModels: ["shared-model"],
          enabled: true,
          priority: 1,
        },
        {
          id: "unknown-limit",
          displayName: "Unknown Limit",
          protocol: "openai",
          baseUrl: "https://unknown.example/v1",
          apiKeyEnv: "UNKNOWN_KEY",
          supportedModels: ["shared-model"],
          enabled: true,
          priority: 2,
        },
      ],
    };
    const registry = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(config),
    });
    const lookup = vi
      .spyOn(registry, "lookup")
      .mockResolvedValueOnce({
        chat: true,
        tools: true,
        vision: true,
        streaming: true,
        structuredOutputs: true,
        promptCaching: true,
        reasoning: true,
        maxTokens: 4096,
      })
      .mockResolvedValueOnce({
        chat: true,
        tools: false,
        vision: false,
        streaming: true,
        structuredOutputs: false,
        promptCaching: false,
        reasoning: false,
        maxTokens: 1024,
      })
      .mockResolvedValueOnce({
        chat: true,
        tools: true,
        vision: true,
        streaming: true,
        structuredOutputs: true,
        promptCaching: true,
        reasoning: true,
        maxTokens: 0,
      });

    await expect(registry.lookupModel("shared-model", undefined, "vercel-ai")).resolves.toEqual({
      chat: true,
      tools: false,
      vision: false,
      streaming: true,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    expect(lookup).toHaveBeenNthCalledWith(1, "full", "shared-model", "vercel-ai", undefined);
    expect(lookup).toHaveBeenNthCalledWith(2, "limited", "shared-model", "vercel-ai", undefined);
    expect(lookup).toHaveBeenNthCalledWith(
      3,
      "unknown-limit",
      "shared-model",
      "vercel-ai",
      undefined,
    );
  });

  it("intersects heterogeneous live-provider probe results before an Agent can use fallback", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    process.env.FULL_PROBE_KEY = "full-secret";
    process.env.LIMITED_PROBE_KEY = "limited-secret";
    const config: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "shared-model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "full-live",
          displayName: "Full Live",
          protocol: "openai",
          baseUrl: "https://full-live.example/v1",
          apiKeyEnv: "FULL_PROBE_KEY",
          supportedModels: ["shared-model"],
          enabled: true,
          priority: 0,
        },
        {
          id: "limited-live",
          displayName: "Limited Live",
          protocol: "anthropic",
          baseUrl: "https://limited-live.example/v1",
          apiKeyEnv: "LIMITED_PROBE_KEY",
          supportedModels: ["shared-model"],
          enabled: true,
          priority: 1,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
        const url = String(input);
        if (url === "https://models.dev/api.json") return new Response(null, { status: 404 });
        if (url.startsWith("https://full-live.example/")) {
          return new Response(null, { status: 200 });
        }
        const body = typeof init?.body === "string" ? init.body : "";
        const unsupported = body.includes('"tools"') || body.includes('"type":"image"');
        return new Response(null, { status: unsupported ? 400 : 200 });
      }),
    );
    const registry = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(config),
    });

    await expect(registry.lookupModel("shared-model", undefined, "vercel-ai")).resolves.toEqual({
      chat: true,
      tools: false,
      vision: false,
      streaming: true,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    });
    delete process.env.FULL_PROBE_KEY;
    delete process.env.LIMITED_PROBE_KEY;
  });

  it("uses shared circuit and per-request admission for live provider probes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    process.env.PROBE_ADMISSION_KEY = "probe-secret";
    const config: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "shared-model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "admitted",
          displayName: "Admitted",
          protocol: "openai",
          baseUrl: "https://admitted.example/v1",
          apiKeyEnv: "PROBE_ADMISSION_KEY",
          supportedModels: ["shared-model"],
          rateLimit: { requestsPerMinute: 2, tokensPerMinute: 1_000 },
          enabled: true,
          priority: 0,
        },
      ],
    };
    const providerRequests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        const url = String(input);
        if (url === "https://models.dev/api.json") return new Response(null, { status: 404 });
        providerRequests.push(url);
        return new Response(null, { status: 200 });
      }),
    );
    const runtime = new ProviderRuntimeState(config);
    const registry = new CapabilityRegistry({ workspaceRoot: root, providerRuntime: runtime });

    const capabilities = await registry.lookupModel("shared-model", "admitted", "vercel-ai");

    expect(providerRequests).toHaveLength(2);
    expect(capabilities).toMatchObject({ chat: true });
    const provider = runtime.registry.getProviders()[0];
    if (!provider) throw new Error("provider fixture missing");
    expect(runtime.reserve(provider, 1)).toMatchObject({ allowed: false, reason: "requests" });

    runtime.openCircuit("admitted");
    const secondRoot = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(secondRoot);
    const circuitRegistry = new CapabilityRegistry({
      workspaceRoot: secondRoot,
      providerRuntime: runtime,
    });
    await expect(
      circuitRegistry.lookupModel("shared-model", "admitted", "other-sdk"),
    ).resolves.toMatchObject({ chat: false, tools: false });
    expect(providerRequests).toHaveLength(2);
    delete process.env.PROBE_ADMISSION_KEY;
  });

  it("updates shared circuit state from admitted probe HTTP outcomes only", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    process.env.PROBE_CIRCUIT_KEY = "probe-secret";
    const config: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "shared-model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "circuit-provider",
          displayName: "Circuit Provider",
          protocol: "openai",
          baseUrl: "https://circuit.example/v1",
          apiKeyEnv: "PROBE_CIRCUIT_KEY",
          enabled: true,
          priority: 0,
        },
      ],
    };
    const transientRuntime = new ProviderRuntimeState(config);
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input) === "https://models.dev/api.json"
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 503 }),
      ),
    );
    const transientRegistry = new CapabilityRegistry({
      workspaceRoot: root,
      providerRuntime: transientRuntime,
    });
    await transientRegistry.lookupModel("shared-model", "circuit-provider", "transient-sdk");
    expect(transientRuntime.isCircuitOpen("circuit-provider")).toBe(true);

    const authRoot = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(authRoot);
    const authRuntime = new ProviderRuntimeState(config);
    resetModelsDevCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) =>
        String(input) === "https://models.dev/api.json"
          ? new Response(null, { status: 404 })
          : new Response(null, { status: 401 }),
      ),
    );
    await new CapabilityRegistry({
      workspaceRoot: authRoot,
      providerRuntime: authRuntime,
    }).lookupModel("shared-model", "circuit-provider", "auth-sdk");
    expect(authRuntime.isCircuitOpen("circuit-provider")).toBe(false);

    const successRoot = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(successRoot);
    const successRuntime = new ProviderRuntimeState(config);
    resetModelsDevCache();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string | URL | Request) => {
        if (String(input) === "https://models.dev/api.json") {
          return new Response(null, { status: 404 });
        }
        successRuntime.openCircuit("circuit-provider");
        return new Response(null, { status: 200 });
      }),
    );
    await new CapabilityRegistry({
      workspaceRoot: successRoot,
      providerRuntime: successRuntime,
    }).lookupModel("shared-model", "circuit-provider", "success-sdk");
    expect(successRuntime.isCircuitOpen("circuit-provider")).toBe(false);
    delete process.env.PROBE_CIRCUIT_KEY;
  });

  it("does not reuse a durable capability entry after endpoint or protocol changes", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    process.env.CACHE_IDENTITY_KEY = "probe-secret";
    const baseConfig: Config = {
      ROOT: root,
      INBOX_ROOT: root,
      SESSIONS_DIR: root,
      AGENTS_DIR: root,
      PROVIDER_ENDPOINT: "https://legacy.example/v1",
      API_KEY_ENV: "LEGACY_KEY",
      DEFAULT_MODEL: "shared-model",
      MAX_CONCURRENT_AGENTS: 1,
      PROVIDERS: [
        {
          id: "changing",
          displayName: "Changing",
          protocol: "openai",
          baseUrl: "https://first.example/v1",
          apiKeyEnv: "CACHE_IDENTITY_KEY",
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
          : new Response(null, { status: 200 }),
      ),
    );
    const first = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(baseConfig),
    });
    await expect(first.lookupModel("shared-model", "changing", "vercel-ai")).resolves.toMatchObject(
      { chat: true },
    );

    resetModelsDevCache();
    delete process.env.CACHE_IDENTITY_KEY;
    const changedConfig: Config = {
      ...baseConfig,
      PROVIDERS: [
        {
          ...baseConfig.PROVIDERS?.[0],
          id: "changing",
          displayName: "Changing",
          protocol: "anthropic",
          baseUrl: "https://second.example/v1",
          apiKeyEnv: "CACHE_IDENTITY_KEY",
          enabled: true,
          priority: 0,
        },
      ],
    };
    const changed = new CapabilityRegistry({
      workspaceRoot: root,
      providerRegistry: new ProviderRegistry(changedConfig),
    });

    await expect(
      changed.lookupModel("shared-model", "changing", "vercel-ai"),
    ).resolves.toMatchObject({ chat: false, tools: false });
  });

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
