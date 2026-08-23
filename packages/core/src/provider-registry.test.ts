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
});
