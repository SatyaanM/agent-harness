import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { loadAgentConfig } from "./config-loader.js";

const tempDirs: string[] = [];

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("loadAgentConfig", () => {
  it("loads a validated per-agent provider override from frontmatter", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "agent-provider-"));
    tempDirs.push(dir);
    const file = path.join(dir, "routed.md");
    await writeFile(
      file,
      [
        "---",
        "name: routed",
        "model: shared-model",
        "provider: preferred-provider",
        "tools: []",
        "maxSteps: 1",
        "---",
        "Use the configured provider.",
      ].join("\n"),
    );

    expect(loadAgentConfig(file)).toEqual(
      expect.objectContaining({ provider: "preferred-provider", model: "shared-model" }),
    );
  });

  it("preserves every supported partial capability override from frontmatter", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-config-"));
    tempDirs.push(root);
    const file = path.join(root, "agent.md");
    await writeFile(
      file,
      `---
name: bounded
model: provider/model
tools: []
maxSteps: 2
capabilities:
  chat: false
  tools: false
  vision: true
  streaming: false
  structuredOutputs: true
  promptCaching: true
  reasoning: true
  maxTokens: 1234
---
Follow the bounds.
`,
      "utf8",
    );

    expect(loadAgentConfig(file).capabilities).toEqual({
      chat: false,
      tools: false,
      vision: true,
      streaming: false,
      structuredOutputs: true,
      promptCaching: true,
      reasoning: true,
      maxTokens: 1234,
    });
  });

  it("does not manufacture overrides for omitted capability fields", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-config-"));
    tempDirs.push(root);
    const file = path.join(root, "agent.md");
    await writeFile(
      file,
      `---
name: bounded
model: provider/model
tools: []
maxSteps: 2
capabilities:
  tools: false
---
Follow the bounds.
`,
      "utf8",
    );

    expect(loadAgentConfig(file).capabilities).toEqual({ tools: false });
  });

  it("preserves compaction opt-out and threshold controls from frontmatter", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "agent-config-compaction-"));
    tempDirs.push(directory);
    const file = path.join(directory, "agent.md");
    await writeFile(
      file,
      `---
name: compact-agent
model: fake-model
tools: []
maxSteps: 2
compaction: false
compactionThreshold: 0.7
compactionKeepRecentMessages: 10
compactionChunkMessages: 24
capabilities:
  chat: true
  tools: false
  vision: false
  streaming: true
  contextWindowTokens: 128000
  maxTokens: 4096
---
Keep the transcript exact.
`,
      "utf8",
    );

    expect(loadAgentConfig(file)).toEqual(
      expect.objectContaining({
        compaction: false,
        compactionThreshold: 0.7,
        compactionKeepRecentMessages: 10,
        compactionChunkMessages: 24,
        capabilities: expect.objectContaining({
          contextWindowTokens: 128_000,
          maxTokens: 4_096,
        }),
      }),
    );
  });
});
