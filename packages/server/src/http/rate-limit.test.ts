import { describe, expect, it, vi } from "vitest";
import { BoundedRateLimitStore, createRouteLimiters, RATE_LIMIT_POLICIES } from "./rate-limit.js";

describe("bounded route rate limiting", () => {
  it("allows requests through the configured limit and reports exhaustion after it", async () => {
    const store = new BoundedRateLimitStore({ maxClients: 4, windowMs: 1_000 });

    expect((await store.increment("client-a")).totalHits).toBe(1);
    expect((await store.increment("client-a")).totalHits).toBe(2);
    expect((await store.increment("client-a")).totalHits).toBe(3);
  });

  it("resets an identity after its fixed window expires", async () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date("2026-08-29T12:00:00Z"));
      const store = new BoundedRateLimitStore({ maxClients: 4, windowMs: 1_000 });
      await store.increment("client-a");
      await store.increment("client-a");

      vi.advanceTimersByTime(1_001);

      expect((await store.increment("client-a")).totalHits).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("keeps independent counters for independent client identities", async () => {
    const store = new BoundedRateLimitStore({ maxClients: 4, windowMs: 1_000 });
    await store.increment("client-a");
    await store.increment("client-a");

    expect((await store.increment("client-b")).totalHits).toBe(1);
    expect((await store.get("client-a"))?.totalHits).toBe(2);
  });

  it("bounds client state and evicts the oldest entry when capacity is reached", async () => {
    const store = new BoundedRateLimitStore({ maxClients: 2, windowMs: 60_000 });
    await store.increment("client-a");
    await store.increment("client-b");
    await store.increment("client-c");

    expect(store.size).toBe(2);
    expect(await store.get("client-a")).toBeUndefined();
    expect(await store.get("client-b")).toBeDefined();
    expect(await store.get("client-c")).toBeDefined();
  });

  it("uses the Express network identity and ignores caller-selected forwarding headers", () => {
    const limiters = createRouteLimiters();
    const requestWithForwardedHeader = {
      ip: "127.0.0.1",
      headers: { "x-forwarded-for": "203.0.113.10" },
    };
    const key = limiters.clientKey(requestWithForwardedHeader);

    expect(key).toBe("127.0.0.1");
  });

  it("defines finite limits and windows for every protected route class", () => {
    for (const policy of Object.values(RATE_LIMIT_POLICIES)) {
      expect(policy.limit).toBeGreaterThan(0);
      expect(policy.windowMs).toBeGreaterThan(0);
      expect(policy.maxClients).toBeGreaterThanOrEqual(policy.limit);
    }
  });
});
