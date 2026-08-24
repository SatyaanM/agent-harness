import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { RegistryEntrySchema } from "../capability/types.js";
import { parseJsonBoundary } from "../validation.js";
import { CapabilityCache } from "./capability-cache.js";

const tempDirs: string[] = [];

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capcache-"));
  tempDirs.push(root);
  return { root, cache: new CapabilityCache(root) };
}

const validEntry = {
  provider: "openai",
  model: "gpt-4o",
  sdk: "vercel-ai",
  caps: {
    chat: true,
    tools: true,
    vision: false,
    streaming: true,
    maxTokens: 4096,
    structuredOutputs: false,
    promptCaching: false,
    reasoning: false,
  },
  source: "cache" as const,
  probedAt: new Date().toISOString(),
};

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CapabilityCache", () => {
  it("saves and loads cache atomically", async () => {
    const { root, cache } = await makeFixture();

    await cache.saveCache([validEntry]);
    const loaded = await cache.loadCache();
    expect(loaded).toEqual([validEntry]);

    const diskRaw = await readFile(path.join(root, ".harness", "capabilities.json"), "utf8");
    expect(
      parseJsonBoundary(z.array(RegistryEntrySchema), diskRaw, "capability cache test"),
    ).toEqual([validEntry]);
  });

  it("upserts and invalidates cache entries", async () => {
    const { cache } = await makeFixture();

    await cache.upsertEntry(validEntry);
    expect(await cache.getEntry("openai", "gpt-4o", "vercel-ai")).toEqual(validEntry);

    await cache.invalidate("openai", "gpt-4o", "vercel-ai");
    expect(await cache.getEntry("openai", "gpt-4o", "vercel-ai")).toBeUndefined();
  });

  it("keeps entries for different non-secret provider configuration identities distinct", async () => {
    const { cache } = await makeFixture();
    const first = { ...validEntry, providerConfigId: "openai:https://first.example/v1" };
    const second = { ...validEntry, providerConfigId: "anthropic:https://second.example/v1" };

    await cache.upsertEntry(first);
    await cache.upsertEntry(second);

    await expect(
      cache.getEntry("openai", "gpt-4o", "vercel-ai", first.providerConfigId),
    ).resolves.toEqual(first);
    await expect(
      cache.getEntry("openai", "gpt-4o", "vercel-ai", second.providerConfigId),
    ).resolves.toEqual(second);
  });
});
