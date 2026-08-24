import type { Config, ProviderEntry } from "./config.js";
import { ProviderRegistry } from "./provider-registry.js";

const WINDOW_MS = 60_000;
const CIRCUIT_MS = 60_000;

interface WindowUsage {
  startedAt: number;
  requests: number;
  tokens: number;
}

export interface ProviderRuntimeOptions {
  now?: () => number;
}

export type ProviderAdmission =
  | { allowed: true }
  | { allowed: false; reason: "requests" | "tokens"; retryAfterMs: number };

/** Process-generation provider health and admission state, owned by the server. */
export class ProviderRuntimeState {
  readonly registry: ProviderRegistry;
  private readonly now: () => number;
  private readonly circuits = new Map<string, number>();
  private readonly usage = new Map<string, WindowUsage>();

  constructor(config: Config, options: ProviderRuntimeOptions = {}) {
    this.registry = new ProviderRegistry(config);
    this.now = options.now ?? Date.now;
  }

  reserve(provider: ProviderEntry, estimatedTokens: number): ProviderAdmission {
    const limit = provider.rateLimit;
    if (!limit) return { allowed: true };
    const now = this.now();
    let usage = this.usage.get(provider.id);
    if (!usage || now - usage.startedAt >= WINDOW_MS) {
      usage = { startedAt: now, requests: 0, tokens: 0 };
      this.usage.set(provider.id, usage);
    }
    const retryAfterMs = Math.max(1, WINDOW_MS - (now - usage.startedAt));
    if (limit.requestsPerMinute !== undefined && usage.requests + 1 > limit.requestsPerMinute) {
      return { allowed: false, reason: "requests", retryAfterMs };
    }
    if (
      limit.tokensPerMinute !== undefined &&
      usage.tokens + estimatedTokens > limit.tokensPerMinute
    ) {
      return { allowed: false, reason: "tokens", retryAfterMs };
    }
    usage.requests += 1;
    usage.tokens += estimatedTokens;
    return { allowed: true };
  }

  openCircuit(providerId: string): void {
    this.circuits.set(providerId, this.now());
  }

  closeCircuit(providerId: string): void {
    this.circuits.delete(providerId);
  }

  isCircuitOpen(providerId: string): boolean {
    const openedAt = this.circuits.get(providerId);
    if (openedAt === undefined) return false;
    if (this.now() - openedAt < CIRCUIT_MS) return true;
    this.circuits.delete(providerId);
    return false;
  }
}
