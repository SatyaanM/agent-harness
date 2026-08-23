import type { CapabilityMatrix } from "../agent/types.js";
import { CapabilityCache } from "../persistence/capability-cache.js";
import { fetchCapabilities } from "./models-dev-client.js";
import { correlateName } from "./name-correlation.js";
import { probeCapabilities } from "./probe.js";
import type { AgentConfigRef, RegistryEntry } from "./types.js";

export interface RegistryOptions {
  workspaceRoot: string;
  baseUrl?: string;
  apiKey?: string;
}

export class CapabilityRegistry {
  private cache: CapabilityCache;
  private baseUrl: string;
  private apiKey: string;

  constructor(options: RegistryOptions) {
    this.cache = new CapabilityCache(options.workspaceRoot);
    this.baseUrl = options.baseUrl ?? "";
    this.apiKey = options.apiKey ?? "";
  }

  async lookup(
    provider: string,
    model: string,
    sdk: string,
    agentConfig?: AgentConfigRef,
  ): Promise<CapabilityMatrix> {
    // Resolve base matrix from tiers 2-4 (cache, models.dev, probe, defaults)
    const base = await this.resolveBaseMatrix(provider, model, sdk, agentConfig);

    if (agentConfig?.capabilities) {
      // Merge user's partial overrides on top of the resolved base matrix
      const manual: CapabilityMatrix = { ...base, ...agentConfig.capabilities };
      await this.cacheEntry({
        provider,
        model,
        sdk,
        caps: manual,
        source: "manual",
        probedAt: new Date().toISOString(),
      });
      return manual;
    }

    return base;
  }

  private async resolveBaseMatrix(
    provider: string,
    model: string,
    sdk: string,
    agentConfig?: AgentConfigRef,
  ): Promise<CapabilityMatrix> {
    const cached = await this.cache.getEntry(provider, model, sdk);
    if (cached) {
      return cached.caps;
    }

    const correlatedId = correlateName(provider, model, agentConfig?.modelIdMapping);
    const modelsDevCaps = await fetchCapabilities(provider, model, correlatedId);
    if (modelsDevCaps) {
      const entry: RegistryEntry = {
        provider,
        model,
        sdk,
        caps: modelsDevCaps,
        source: "models.dev",
        probedAt: new Date().toISOString(),
      };
      await this.cacheEntry(entry);
      return modelsDevCaps;
    }

    if (this.baseUrl && this.apiKey) {
      const probedCaps = await probeCapabilities({
        baseUrl: this.baseUrl,
        apiKey: this.apiKey,
        model,
      });
      const entry: RegistryEntry = {
        provider,
        model,
        sdk,
        caps: probedCaps,
        source: "probe",
        probedAt: new Date().toISOString(),
      };
      await this.cacheEntry(entry);
      return probedCaps;
    }

    return {
      chat: true,
      tools: true,
      vision: true,
      streaming: false,
      structuredOutputs: false,
      promptCaching: false,
      reasoning: false,
      maxTokens: 0,
    };
  }

  private async cacheEntry(entry: RegistryEntry): Promise<void> {
    await this.cache.upsertEntry(entry);
  }

  async invalidate(provider: string, model: string, sdk: string): Promise<void> {
    await this.cache.invalidate(provider, model, sdk);
  }
}
