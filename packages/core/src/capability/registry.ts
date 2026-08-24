import type { CapabilityMatrix } from "../agent/types.js";
import { CapabilityCache } from "../persistence/capability-cache.js";
import type { ProviderRegistry, ProviderTarget } from "../provider-registry.js";
import type { ProviderRuntimeState } from "../provider-runtime.js";
import { fetchCapabilities } from "./models-dev-client.js";
import { correlateName } from "./name-correlation.js";
import { probeCapabilities } from "./probe.js";
import type { AgentConfigRef, RegistryEntry } from "./types.js";

export interface RegistryOptions {
  workspaceRoot: string;
  baseUrl?: string;
  apiKey?: string;
  providerRegistry?: ProviderRegistry;
  providerRuntime?: ProviderRuntimeState;
}

export class CapabilityRegistry {
  private cache: CapabilityCache;
  private baseUrl: string;
  private apiKey: string;
  private providerRegistry: ProviderRegistry | undefined;
  private providerRuntime: ProviderRuntimeState | undefined;

  constructor(options: RegistryOptions) {
    this.cache = new CapabilityCache(options.workspaceRoot);
    this.baseUrl = options.baseUrl ?? "";
    this.apiKey = options.apiKey ?? "";
    this.providerRuntime = options.providerRuntime;
    this.providerRegistry = options.providerRuntime?.registry ?? options.providerRegistry;
  }

  async lookupModel(
    model: string,
    preferredProviderId: string | undefined,
    sdk: string,
    agentConfig?: AgentConfigRef,
  ): Promise<CapabilityMatrix> {
    const targets = this.providerRegistry?.resolveTargets(model, preferredProviderId);
    if (!targets) return this.lookup(preferredProviderId ?? "default", model, sdk, agentConfig);
    if (targets.length === 0) return conservativeCapabilities();
    const matrices: CapabilityMatrix[] = [];
    for (const target of targets) {
      matrices.push(await this.lookup(target.provider.id, target.modelId, sdk, agentConfig));
    }
    return intersectCapabilityMatrices(matrices);
  }

  async lookup(
    provider: string,
    model: string,
    sdk: string,
    agentConfig?: AgentConfigRef,
  ): Promise<CapabilityMatrix> {
    // Resolve base matrix from tiers 2-4 (cache, models.dev, probe, defaults)
    const providerTarget = this.providerRegistry
      ?.resolveTargets(model, provider)
      .find((target) => target.provider.id === provider);
    const providerConfigId = providerTarget
      ? providerConfigurationIdentity(providerTarget)
      : undefined;
    const base = await this.resolveBaseMatrix(
      provider,
      model,
      sdk,
      agentConfig,
      providerTarget,
      providerConfigId,
    );

    if (agentConfig?.capabilities) {
      // Merge user's partial overrides on top of the resolved base matrix
      // Tier-1 bounds belong to this agent invocation. Persisting the merged
      // matrix would leak one agent's restrictions into every agent using the
      // same provider/model/SDK cache key.
      return { ...base, ...agentConfig.capabilities };
    }

    return base;
  }

  private async resolveBaseMatrix(
    provider: string,
    model: string,
    sdk: string,
    agentConfig?: AgentConfigRef,
    providerTarget?: ProviderTarget,
    providerConfigId?: string,
  ): Promise<CapabilityMatrix> {
    const cached = await this.cache.getEntry(provider, model, sdk, providerConfigId);
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
        ...(providerConfigId ? { providerConfigId } : {}),
        caps: modelsDevCaps,
        source: "models.dev",
        probedAt: new Date().toISOString(),
      };
      await this.cacheEntry(entry);
      return modelsDevCaps;
    }

    if (providerTarget) {
      const apiKey = process.env[providerTarget.provider.apiKeyEnv];
      if (!apiKey) return conservativeCapabilities();
      if (this.providerRuntime?.isCircuitOpen(providerTarget.provider.id)) {
        return conservativeCapabilities();
      }
      let unstableProbe = false;
      try {
        const probedCaps = await probeCapabilities(
          {
            baseUrl: providerTarget.provider.baseUrl,
            apiKey,
            model: providerTarget.modelId,
            protocol: providerTarget.protocol,
          },
          {
            beforeRequest: (estimatedTokens) => {
              if (this.providerRuntime?.isCircuitOpen(providerTarget.provider.id)) return false;
              const admission = this.providerRuntime?.reserve(
                providerTarget.provider,
                estimatedTokens,
              );
              return admission?.allowed ?? true;
            },
            onResponse: (_status, succeeded) => {
              if (!this.providerRuntime) return;
              if (succeeded) {
                this.providerRuntime.closeCircuit(providerTarget.provider.id);
              }
            },
            onOutcome: (outcome) => {
              if (outcome === "admission-denied" || outcome === "rejected") {
                unstableProbe = true;
              }
            },
            onTransientExhausted: (status) => {
              unstableProbe = true;
              if (status === 429 || (status !== undefined && status >= 500 && status < 600)) {
                this.providerRuntime?.openCircuit(providerTarget.provider.id);
              }
            },
          },
        );
        // Exhausted-transient, rejected, or admission-denied results can change
        // without a provider configuration edit, so their partial matrix is never durable.
        if (unstableProbe) return probedCaps;
        const entry: RegistryEntry = {
          provider,
          model,
          sdk,
          ...(providerConfigId ? { providerConfigId } : {}),
          caps: probedCaps,
          source: "probe",
          probedAt: new Date().toISOString(),
        };
        await this.cacheEntry(entry);
        return probedCaps;
      } catch {
        return conservativeCapabilities();
      }
    }

    if (this.baseUrl && this.apiKey) {
      let unstableProbe = false;
      const probedCaps = await probeCapabilities(
        {
          baseUrl: this.baseUrl,
          apiKey: this.apiKey,
          model,
        },
        {
          onOutcome: (outcome) => {
            if (outcome === "rejected") unstableProbe = true;
          },
          onTransientExhausted: () => {
            unstableProbe = true;
          },
        },
      );
      if (unstableProbe) return probedCaps;
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

function conservativeCapabilities(): CapabilityMatrix {
  return {
    chat: false,
    tools: false,
    vision: false,
    streaming: false,
    structuredOutputs: false,
    promptCaching: false,
    reasoning: false,
    maxTokens: 0,
  };
}

function providerConfigurationIdentity(target: ProviderTarget): string {
  return `${target.protocol}:${target.provider.baseUrl.replace(/\/+$/u, "")}:${target.provider.apiKeyEnv}`;
}

function intersectCapabilityMatrices(matrices: CapabilityMatrix[]): CapabilityMatrix {
  const [first, ...rest] = matrices;
  if (!first) return conservativeCapabilities();
  const knownMaxTokens = matrices
    .map((matrix) => matrix.maxTokens)
    .filter((maxTokens) => maxTokens > 0);
  return rest.reduce<CapabilityMatrix>(
    (intersection, matrix) => ({
      chat: intersection.chat && matrix.chat,
      tools: intersection.tools && matrix.tools,
      vision: intersection.vision && matrix.vision,
      streaming: intersection.streaming && matrix.streaming,
      structuredOutputs: intersection.structuredOutputs && matrix.structuredOutputs,
      promptCaching: intersection.promptCaching && matrix.promptCaching,
      reasoning: intersection.reasoning && matrix.reasoning,
      maxTokens: knownMaxTokens.length > 0 ? Math.min(...knownMaxTokens) : 0,
    }),
    first,
  );
}
