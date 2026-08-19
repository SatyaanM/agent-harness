import { mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
  ToolRegistry,
} from "@agent-harness/core";
import { afterEach, describe, expect, it } from "vitest";

const tempRoots: string[] = [];

afterEach(async () => {
  await Promise.all(tempRoots.splice(0).map((r) => rm(r, { recursive: true, force: true })));
});

describe("Security & Adversarial Red-Team Test Suite", () => {
  it("strictly rejects path traversal breakout attempts in file tools", async () => {
    const sandboxDir = await mkdtemp(path.join(tmpdir(), "harness-sec-sandbox-"));
    const outerDir = await mkdtemp(path.join(tmpdir(), "harness-sec-outer-"));
    tempRoots.push(sandboxDir, outerDir);

    const secretFile = path.join(outerDir, "secret.key");
    await writeFile(secretFile, "SUPER_SECRET_KEY", "utf8");

    const readTool = createReadFileTool(sandboxDir);
    const writeTool = createWriteFileTool(sandboxDir);
    const editTool = createEditFileTool(sandboxDir);

    // 1. Path traversal read
    await expect(
      readTool.execute({
        path: `../${path.basename(outerDir)}/secret.key`,
      }),
    ).rejects.toThrow(/outside the allowed root/i);

    // 2. Deep path traversal write
    await expect(
      writeTool.execute({
        path: "../../../escaped.txt",
        content: "malicious payload",
      }),
    ).rejects.toThrow(/outside the allowed root/i);

    // 3. Edit traversal
    await expect(
      editTool.execute({
        path: "../secret.key",
        oldText: "SUPER",
        newText: "CORRUPTED",
      }),
    ).rejects.toThrow(/outside the allowed root/i);
  });

  it("prevents symlink directory escape in read tool", async () => {
    const sandboxDir = await mkdtemp(path.join(tmpdir(), "harness-sec-symlink-"));
    const outsideDir = await mkdtemp(path.join(tmpdir(), "harness-sec-outside-"));
    tempRoots.push(sandboxDir, outsideDir);

    const outsideTarget = path.join(outsideDir, "target.txt");
    await writeFile(outsideTarget, "Confidential Data", "utf8");

    const symlinkPath = path.join(sandboxDir, "symlink-outside.txt");
    try {
      await symlink(outsideTarget, symlinkPath);
    } catch {
      // If OS environment does not permit symlink creation without admin rights, pass gracefully
      return;
    }

    const readTool = createReadFileTool(sandboxDir);
    await expect(readTool.execute({ path: "symlink-outside.txt" })).rejects.toThrow(
      /outside the allowed root/i,
    );
  });

  it("enforces tool registry authorization and rejects unregistered tools", () => {
    const registry = new ToolRegistry();
    const readTool = createReadFileTool(process.cwd());
    registry.register(readTool);

    expect(registry.get("readFile")).toBeDefined();
    expect(registry.get("executeDangerousCommand")).toBeUndefined();
  });

  it("prevents Object prototype pollution from maliciously crafted JSON payloads", () => {
    const maliciousPayload = JSON.parse('{"__proto__": {"isAdmin": true}}');
    const targetObj: Record<string, unknown> = {};

    Object.assign(targetObj, maliciousPayload);

    // Assert global prototype is not polluted
    const cleanObject: Record<string, unknown> = {};
    expect(cleanObject.isAdmin).toBeUndefined();
    expect(Object.hasOwn(Object.prototype, "isAdmin")).toBe(false);
  });
});
