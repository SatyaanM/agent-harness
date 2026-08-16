import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BoundaryValidationError } from "../validation.js";
import { InboxManager } from "./inbox.js";

const tempDirs: string[] = [];

async function makeDirectory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-harness-inbox-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("InboxManager durable metadata", () => {
  it("serializes concurrent updates from separate manager instances without losing an entry", async () => {
    const dir = await makeDirectory();
    const first = new InboxManager(dir);
    const second = new InboxManager(dir);

    await Promise.all([
      first.trackItem("one.md", { title: "One", type: "markdown", authorAgent: "agent-one" }),
      second.trackItem("two.md", { title: "Two", type: "markdown", authorAgent: "agent-two" }),
    ]);

    const persisted = await readFile(path.join(dir, ".harness", "inbox-metadata.json"), "utf8");
    expect(persisted).toContain('"one.md"');
    expect(persisted).toContain('"two.md"');
  });

  it("rejects malformed durable metadata instead of trusting or replacing it", async () => {
    const dir = await makeDirectory();
    const metadataFile = path.join(dir, ".harness", "inbox-metadata.json");
    await mkdir(path.dirname(metadataFile), { recursive: true });
    await writeFile(metadataFile, '{"item":{"version":"invalid"}}', "utf8");

    await expect(new InboxManager(dir).listItems()).rejects.toBeInstanceOf(BoundaryValidationError);
    await expect(readFile(metadataFile, "utf8")).resolves.toBe('{"item":{"version":"invalid"}}');
  });

  it("rejects item identifiers that could delete outside the inbox", async () => {
    const root = await makeDirectory();
    const inbox = path.join(root, "inbox");
    const outsideFile = path.join(root, "outside.txt");
    await mkdir(inbox);
    await writeFile(outsideFile, "preserve me", "utf8");

    await expect(new InboxManager(inbox).deleteItem("../outside.txt")).rejects.toBeInstanceOf(
      BoundaryValidationError,
    );
    await expect(readFile(outsideFile, "utf8")).resolves.toBe("preserve me");
  });

  it("rolls back in-memory metadata when persistence fails", async () => {
    const dir = await makeDirectory();
    const manager = new InboxManager(dir);
    await manager.trackItem("one.md", {
      title: "One",
      type: "markdown",
      authorAgent: "agent-one",
    });
    await mkdir(path.join(dir, ".harness", "inbox-metadata.json.tmp"));

    await expect(manager.bumpVersion("one.md")).rejects.toThrow();

    await expect(manager.getItemMetadata("one.md")).resolves.toEqual(
      expect.objectContaining({ version: 1 }),
    );
  });
});
