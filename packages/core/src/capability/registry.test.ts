import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetModelsDevCache } from "./models-dev-client.js";
import { CapabilityRegistry } from "./registry.js";

const tempDirs: string[] = [];

beforeEach(() => {
  resetModelsDevCache();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => new Response(null, { status: 404 })),
  );
});

afterEach(async () => {
  vi.unstubAllGlobals();
  resetModelsDevCache();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("CapabilityRegistry manual overrides", () => {
  it("preserves an explicit chat override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const registry = new CapabilityRegistry({ workspaceRoot: root });

    const capabilities = await registry.lookup("provider", "model", "sdk", {
      capabilities: {
        chat: false,
        tools: true,
        vision: false,
        streaming: false,
        maxTokens: 100,
      },
    });

    expect(capabilities.chat).toBe(false);
  });

  it("merges partial capability overrides on top of base defaults without wiping unspecified fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const registry = new CapabilityRegistry({ workspaceRoot: root });

    // User only overrides tools to false
    const capabilities = await registry.lookup("unknown-provider", "unknown-model", "unknown-sdk", {
      capabilities: {
        tools: false,
      },
    });

    expect(capabilities.tools).toBe(false);
    // Unspecified fields should retain default values from base matrix
    expect(capabilities.chat).toBe(true);
    expect(capabilities.vision).toBe(true);
  });

  it("does not persist agent-scoped overrides into the shared model cache", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-capabilities-"));
    tempDirs.push(root);
    const registry = new CapabilityRegistry({ workspaceRoot: root });

    const restricted = await registry.lookup("provider", "model", "sdk", {
      capabilities: { tools: false, promptCaching: true },
    });
    const unrestricted = await registry.lookup("provider", "model", "sdk");

    expect(restricted.tools).toBe(false);
    expect(restricted.promptCaching).toBe(true);
    expect(unrestricted.tools).toBe(true);
    expect(unrestricted.promptCaching).toBe(false);
  });
});
