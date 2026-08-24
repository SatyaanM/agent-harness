import { describe, expect, it } from "vitest";
import type { Config } from "./config.js";
import { ProviderRuntimeState } from "./provider-runtime.js";

const config: Config = {
  ROOT: process.cwd(),
  INBOX_ROOT: process.cwd(),
  SESSIONS_DIR: process.cwd(),
  AGENTS_DIR: process.cwd(),
  PROVIDER_ENDPOINT: "https://legacy.example/v1",
  API_KEY_ENV: "TEST_KEY",
  DEFAULT_MODEL: "vendor/model",
  MAX_CONCURRENT_AGENTS: 1,
  PROVIDERS: [
    {
      id: "limited",
      displayName: "Limited",
      protocol: "openai",
      baseUrl: "https://limited.example/v1",
      apiKeyEnv: "TEST_KEY",
      rateLimit: { requestsPerMinute: 1, tokensPerMinute: 20 },
      enabled: true,
      priority: 0,
    },
  ],
};

describe("ProviderRuntimeState", () => {
  it("enforces request and token reservations across clients without queueing", () => {
    let now = 1_000;
    const state = new ProviderRuntimeState(config, { now: () => now });
    const provider = state.registry.getProviders()[0];
    if (!provider) throw new Error("provider fixture missing");

    expect(state.reserve(provider, 10)).toEqual({ allowed: true });
    expect(state.reserve(provider, 1)).toMatchObject({ allowed: false, reason: "requests" });

    now += 60_000;
    expect(state.reserve(provider, 21)).toMatchObject({ allowed: false, reason: "tokens" });
    expect(state.reserve(provider, 20)).toEqual({ allowed: true });
  });

  it("shares circuit state and closes it after the bounded interval", () => {
    let now = 1_000;
    const state = new ProviderRuntimeState(config, { now: () => now });
    state.openCircuit("limited");
    expect(state.isCircuitOpen("limited")).toBe(true);
    now += 60_000;
    expect(state.isCircuitOpen("limited")).toBe(false);
  });
});
