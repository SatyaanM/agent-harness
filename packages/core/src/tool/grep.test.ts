import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resetConfig } from "../config.js";
import { grepTool } from "./grep.js";

const tempDirs: string[] = [];
const originalRoot = process.env.ROOT;

afterEach(async () => {
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("grep resource limits", () => {
  it("bounds catastrophic regular-expression evaluation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-grep-"));
    tempDirs.push(root);
    process.env.ROOT = root;
    resetConfig();
    await writeFile(path.join(root, "input.txt"), `${"a".repeat(28)}!`, "utf8");

    await expect(grepTool.execute({ pattern: "(a+)+$", path: "input.txt" })).resolves.toContain(
      "regular expression resource limit",
    );
  });
});
