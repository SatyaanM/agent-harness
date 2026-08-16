import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CapabilityRegistry } from "./registry.js";

const tempDirs: string[] = [];

afterEach(async () => {
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
});
