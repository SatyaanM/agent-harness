import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { ProviderRegistry } from "./provider-registry.js";

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

describe("ProviderRegistry", () => {
  it("preserves slash-containing IDs for configured providers and translates only legacy IDs", () => {
    const configured = new ProviderRegistry({
      ...config,
      PROVIDERS: [
        {
          id: "configured",
          displayName: "Configured",
          protocol: "openai",
          baseUrl: "https://configured.example/v1",
          apiKeyEnv: "TEST_KEY",
          enabled: true,
          priority: 0,
        },
      ],
    });
    expect(configured.resolveTargets("vendor/model")[0]?.modelId).toBe("vendor/model");

    const legacy = new ProviderRegistry(config);
    expect(legacy.resolveTargets("opencode-go/qwen3.7-plus")[0]?.modelId).toBe("qwen3.7-plus");
  });

  it("uses legacy fallback when no providers are configured", () => {
    const registry = new ProviderRegistry(config);
    const providers = registry.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("default");
    expect(providers[0]?.protocol).toBe("openai");
  });

  it("filters out disabled providers", () => {
    const registry = new ProviderRegistry({
      ...config,
      PROVIDERS: [
        {
          id: "enabled",
          displayName: "Enabled",
          protocol: "openai",
          baseUrl: "http://test",
          apiKeyEnv: "TEST",
          enabled: true,
          priority: 0,
        },
        {
          id: "disabled",
          displayName: "Disabled",
          protocol: "openai",
          baseUrl: "http://test2",
          apiKeyEnv: "TEST",
          enabled: false,
          priority: 1,
        },
      ],
    });
    const providers = registry.getProviders();
    expect(providers).toHaveLength(1);
    expect(providers[0]?.id).toBe("enabled");
  });

  it("sorts eligible providers by priority and model pattern matching", () => {
    const registry = new ProviderRegistry({
      ...config,
      PROVIDERS: [
        {
          id: "fallback",
          displayName: "Fallback",
          protocol: "openai",
          baseUrl: "http://test",
          apiKeyEnv: "TEST",
          enabled: true,
          priority: 10,
        },
        {
          id: "fast",
          displayName: "Fast",
          protocol: "openai",
          baseUrl: "http://test",
          apiKeyEnv: "TEST",
          enabled: true,
          priority: 1,
          supportedModels: ["gpt-4o-mini", "gpt-3.5*"],
        },
        {
          id: "slow",
          displayName: "Slow",
          protocol: "openai",
          baseUrl: "http://test",
          apiKeyEnv: "TEST",
          enabled: true,
          priority: 5,
          supportedModels: ["gpt-4*"],
        },
      ],
    });

    // Requesting gpt-4o should return slow, fallback
    const gpt4o = registry.resolveProvider("gpt-4o");
    expect(gpt4o.map((p) => p.id)).toEqual(["slow", "fallback"]);

    // Requesting gpt-4o-mini should return fast, slow, fallback
    const gpt4omini = registry.resolveProvider("gpt-4o-mini");
    expect(gpt4omini.map((p) => p.id)).toEqual(["fast", "slow", "fallback"]);

    // With preferred
    const withPreferred = registry.resolveProvider("gpt-4o-mini", "fallback");
    expect(withPreferred.map((p) => p.id)).toEqual(["fallback", "fast", "slow"]);
  });

  it("safely handles glob patterns containing regex metacharacters", () => {
    const registry = new ProviderRegistry({
      ...config,
      PROVIDERS: [
        {
          id: "special-chars",
          displayName: "Special Chars Provider",
          protocol: "openai",
          baseUrl: "https://special.example/v1",
          apiKeyEnv: "TEST",
          enabled: true,
          priority: 1,
          supportedModels: ["qwen3.7-plus*", "custom+model.*", "test(v1)*"],
        },
      ],
    });

    // Exact dot match should match
    expect(registry.resolveProvider("qwen3.7-plus-preview").map((p) => p.id)).toEqual([
      "special-chars",
    ]);
    // Dot should NOT match arbitrary character (e.g. "qwen3X7-plus" should not match "qwen3.7-plus*")
    expect(registry.resolveProvider("qwen3X7-plus-preview")).toEqual([]);
    // Plus sign should match literally
    expect(registry.resolveProvider("custom+model.v2").map((p) => p.id)).toEqual(["special-chars"]);
    // Parentheses should match literally
    expect(registry.resolveProvider("test(v1)-prod").map((p) => p.id)).toEqual(["special-chars"]);
  });
});
