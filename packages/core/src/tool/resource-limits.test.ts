import { mkdtemp, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEditFileTool } from "./editFile.js";
import { createReadFileTool } from "./readFile.js";
import { MAX_WORKSPACE_FILE_BYTES } from "./utils.js";
import { createWriteFileTool } from "./writeFile.js";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("workspace tool resource limits", () => {
  it("rejects oversized and malformed write arguments at the tool schema", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-tool-limits-"));
    tempRoots.push(root);
    const tool = createWriteFileTool(root);

    expect(
      tool.parameters.safeParse({ path: "safe.txt", content: "🙂".repeat(2_500_001) }).success,
    ).toBe(false);
    expect(tool.parameters.safeParse({ path: "bad\0name", content: "ok" }).success).toBe(false);
    expect(
      tool.parameters.safeParse({ path: "safe.txt", content: "ok", extra: true }).success,
    ).toBe(false);
  });

  it("refuses to read or edit files above the workspace byte limit", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-tool-limits-"));
    tempRoots.push(root);
    const file = path.join(root, "large.txt");
    const handle = await open(file, "w");
    await handle.truncate(MAX_WORKSPACE_FILE_BYTES + 1);
    await handle.close();

    await expect(createReadFileTool(root).execute({ path: "large.txt" })).resolves.toContain(
      "maximum readable size",
    );
    await expect(
      createEditFileTool(root).execute({ path: "large.txt", oldText: "a", newText: "b" }),
    ).resolves.toContain("maximum editable size");
  });
});
