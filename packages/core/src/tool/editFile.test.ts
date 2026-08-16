import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createEditFileTool } from "./editFile.js";

const tempDirs: string[] = [];

async function makeFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-editfile-"));
  tempDirs.push(root);
  return { root, tool: createEditFileTool(root) };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("editFile tool", () => {
  it("preserves replacement text containing dollar signs and special replacement patterns", async () => {
    const { root, tool } = await makeFixture();
    const filePath = path.join(root, "script.sh");
    await writeFile(filePath, 'echo "OLD_VALUE"\n', "utf8");

    const result = await tool.execute({
      path: "script.sh",
      oldText: 'echo "OLD_VALUE"',
      newText: 'echo "$PATH" && price="$$50" && text="$& $1"',
    });

    expect(result).toContain("Successfully edited script.sh");
    const updated = await readFile(filePath, "utf8");
    expect(updated).toBe('echo "$PATH" && price="$$50" && text="$& $1"\n');
  });

  it("returns an error if the old text is not found", async () => {
    const { root, tool } = await makeFixture();
    const filePath = path.join(root, "hello.txt");
    await writeFile(filePath, "hello world\n", "utf8");

    const result = await tool.execute({
      path: "hello.txt",
      oldText: "missing text",
      newText: "replacement",
    });

    expect(result).toContain("Error: oldText not found");
  });

  it("returns an error if the file does not exist", async () => {
    const { tool } = await makeFixture();
    const result = await tool.execute({
      path: "nonexistent.txt",
      oldText: "a",
      newText: "b",
    });

    expect(result).toContain("Error: File not found");
  });
});
