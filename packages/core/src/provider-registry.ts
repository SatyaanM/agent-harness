import type { Config, ProviderEntry } from "./config.js";

export interface ProviderTarget {
  provider: ProviderEntry;
  modelId: string;
  protocol: "openai" | "anthropic";
}

/** Escape regex metacharacters in a glob pattern, then convert `*` to `.*`. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, "\\$1").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export class ProviderRegistry {
  private providers: ProviderEntry[] = [];
  private readonly legacy: boolean;

  constructor(config: Config) {
    this.legacy = !config.PROVIDERS || config.PROVIDERS.length === 0;
    if (config.PROVIDERS && config.PROVIDERS.length > 0) {
      this.providers = [...config.PROVIDERS];
    } else {
      // Legacy single-endpoint fallback
      this.providers = [
        {
          id: "default",
          displayName: "Default Provider",
          protocol: "openai", // Will be dynamically adjusted or overridden by specific client logic if needed
          baseUrl: config.PROVIDER_ENDPOINT,
          apiKeyEnv: config.API_KEY_ENV,
          enabled: true,
          priority: 0,
        },
      ];
    }
  }

  resolveTargets(modelId: string, preferredProviderId?: string): ProviderTarget[] {
    return this.resolveProvider(modelId, preferredProviderId).map((provider) => {
      if (!this.legacy) return { provider, modelId, protocol: provider.protocol };
      const translated = modelId.startsWith("opencode-go/")
        ? modelId.slice("opencode-go/".length)
        : modelId;
      return {
        provider,
        modelId: translated,
        protocol: LEGACY_ANTHROPIC_MODELS.has(translated) ? "anthropic" : "openai",
      };
    });
  }

  getProviders(): ProviderEntry[] {
    return this.providers.filter((p) => p.enabled);
  }

  resolveProvider(modelId: string, preferredProviderId?: string): ProviderEntry[] {
    const enabled = this.getProviders();

    // 1. Filter by supported models
    const eligible = enabled.filter((p) => {
      if (!p.supportedModels || p.supportedModels.length === 0) return true;
      return p.supportedModels.some((pattern) => {
        if (pattern.includes("*")) {
          return globToRegex(pattern).test(modelId);
        }
        return pattern === modelId;
      });
    });

    // 2. Sort by priority (lower number = higher priority)
    eligible.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0));

    // 3. Move preferred to front if eligible
    if (preferredProviderId) {
      const preferredIdx = eligible.findIndex((p) => p.id === preferredProviderId);
      if (preferredIdx > 0) {
        const [preferred] = eligible.splice(preferredIdx, 1);
        if (preferred) {
          eligible.unshift(preferred);
        }
      }
    }

    return eligible;
  }
}

const LEGACY_ANTHROPIC_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);
