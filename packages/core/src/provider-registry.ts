import type { Config, ProviderEntry } from "./config.js";

/** Escape regex metacharacters in a glob pattern, then convert `*` to `.*`. */
function globToRegex(pattern: string): RegExp {
  const escaped = pattern.replace(/([.+?^${}()|[\]\\])/g, "\\$1").replace(/\*/g, ".*");
  return new RegExp(`^${escaped}$`);
}

export class ProviderRegistry {
  private providers: ProviderEntry[] = [];

  constructor(config: Config) {
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
