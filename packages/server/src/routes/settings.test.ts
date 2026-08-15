import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig } from "@agent-harness/core";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

const tempDirs: string[] = [];
const originalRoot = process.env.ROOT;

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-settings-routes-"));
  tempDirs.push(root);
  process.env.ROOT = root;
  resetConfig();
  await mkdir(path.join(root, ".harness"), { recursive: true });
  return { app: createApp(), root, settingsFile: path.join(root, ".harness", "settings.json") };
}

afterEach(async () => {
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("settings ownership and repair", () => {
  it("reports the actual environment-owned root instead of a legacy persisted value", async () => {
    const { app, root, settingsFile } = await fixture();
    await writeFile(settingsFile, JSON.stringify({ ROOT: path.join(root, "ignored") }), "utf8");

    const response = await request(app).get("/api/settings");

    expect(response.status).toBe(200);
    expect(response.body.ROOT).toBe(root);
  });

  it("rejects attempts to mutate the environment-owned root", async () => {
    const { app, root } = await fixture();

    const response = await request(app)
      .put("/api/settings")
      .send({ ROOT: path.join(root, "other") });

    expect(response.status).toBe(400);
  });

  it("quarantines malformed settings when a valid update repairs the file", async () => {
    const { app, root, settingsFile } = await fixture();
    await writeFile(settingsFile, "{invalid-json}", "utf8");

    const response = await request(app).put("/api/settings").send({ DEFAULT_MODEL: "fixed-model" });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ ROOT: root, DEFAULT_MODEL: "fixed-model" });
    const files = await readdir(path.join(root, ".harness"));
    const quarantine = files.find((file) => file.startsWith("settings.json.invalid-"));
    expect(quarantine).toBeDefined();
    if (!quarantine) throw new Error("Expected quarantined settings");
    await expect(readFile(path.join(root, ".harness", quarantine), "utf8")).resolves.toBe(
      "{invalid-json}",
    );
  });
});
