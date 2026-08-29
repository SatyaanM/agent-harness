import type { Request, RequestHandler } from "express";
import rateLimit, { type IncrementResponse, ipKeyGenerator, type Store } from "express-rate-limit";

interface Counter {
  totalHits: number;
  resetTime: Date;
}

export interface RateLimitPolicy {
  limit: number;
  maxClients: number;
  windowMs: number;
}

export const RATE_LIMIT_POLICIES = {
  requestEnvelope: { limit: 240, maxClients: 1_024, windowMs: 60_000 },
  configurationRead: { limit: 120, maxClients: 1_024, windowMs: 60_000 },
  configurationWrite: { limit: 30, maxClients: 1_024, windowMs: 60_000 },
  filesystemRead: { limit: 120, maxClients: 1_024, windowMs: 60_000 },
  filesystemWrite: { limit: 60, maxClients: 1_024, windowMs: 60_000 },
  processLaunch: { limit: 10, maxClients: 256, windowMs: 60_000 },
} as const satisfies Record<string, RateLimitPolicy>;

/**
 * Fixed-window, process-local storage for the trusted single-host deployment.
 * Capacity eviction keeps attacker-controlled client cardinality from growing
 * memory without bound. This is an availability control, not authentication.
 */
export class BoundedRateLimitStore implements Store {
  readonly localKeys = true;
  readonly prefix: string;
  private readonly clients = new Map<string, Counter>();

  constructor(
    private readonly options: { maxClients: number; windowMs: number },
    prefix = "bounded-route-limit",
  ) {
    this.prefix = prefix;
  }

  get size(): number {
    this.deleteExpired(Date.now());
    return this.clients.size;
  }

  get(key: string): IncrementResponse | undefined {
    const now = Date.now();
    const counter = this.clients.get(key);
    if (!counter) return undefined;
    if (counter.resetTime.getTime() <= now) {
      this.clients.delete(key);
      return undefined;
    }
    return { totalHits: counter.totalHits, resetTime: counter.resetTime };
  }

  increment(key: string): IncrementResponse {
    const now = Date.now();
    this.deleteExpired(now);
    const current = this.clients.get(key);
    if (current) {
      current.totalHits += 1;
      return { totalHits: current.totalHits, resetTime: current.resetTime };
    }

    if (this.clients.size >= this.options.maxClients) {
      const oldestKey = this.clients.keys().next().value;
      if (typeof oldestKey === "string") this.clients.delete(oldestKey);
    }
    const counter = {
      totalHits: 1,
      resetTime: new Date(now + this.options.windowMs),
    };
    this.clients.set(key, counter);
    return { totalHits: counter.totalHits, resetTime: counter.resetTime };
  }

  decrement(key: string): void {
    const counter = this.clients.get(key);
    if (!counter) return;
    counter.totalHits = Math.max(0, counter.totalHits - 1);
  }

  resetKey(key: string): void {
    this.clients.delete(key);
  }

  resetAll(): void {
    this.clients.clear();
  }

  private deleteExpired(now: number): void {
    for (const [key, counter] of this.clients) {
      if (counter.resetTime.getTime() <= now) this.clients.delete(key);
    }
  }
}

export interface RouteLimiters {
  clientKey: (request: Pick<Request, "ip">) => string;
  requestEnvelope: RequestHandler;
  configurationRead: RequestHandler;
  configurationWrite: RequestHandler;
  filesystemRead: RequestHandler;
  filesystemWrite: RequestHandler;
  processLaunch: RequestHandler;
}

export function createRouteLimiters(): RouteLimiters {
  const clientKey = (request: Pick<Request, "ip">): string =>
    ipKeyGenerator(request.ip ?? "unknown");
  return {
    clientKey,
    requestEnvelope: createLimiter("request-envelope", RATE_LIMIT_POLICIES.requestEnvelope),
    configurationRead: createLimiter("configuration-read", RATE_LIMIT_POLICIES.configurationRead),
    configurationWrite: createLimiter(
      "configuration-write",
      RATE_LIMIT_POLICIES.configurationWrite,
    ),
    filesystemRead: createLimiter("filesystem-read", RATE_LIMIT_POLICIES.filesystemRead),
    filesystemWrite: createLimiter("filesystem-write", RATE_LIMIT_POLICIES.filesystemWrite),
    processLaunch: createLimiter("process-launch", RATE_LIMIT_POLICIES.processLaunch),
  };

  function createLimiter(name: string, policy: RateLimitPolicy): RequestHandler {
    return rateLimit({
      identifier: name,
      keyGenerator: clientKey,
      legacyHeaders: false,
      limit: policy.limit,
      standardHeaders: "draft-8",
      store: new BoundedRateLimitStore(policy, name),
      windowMs: policy.windowMs,
      handler: (_request, response) => {
        response.status(429).json({
          error: { code: "rate_limited", message: "Too many requests; retry later" },
        });
      },
    });
  }
}
