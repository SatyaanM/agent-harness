import { mkdir, mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig } from "@agent-harness/core";
import fs from "fs-extra";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../app.js";
import { RATE_LIMIT_POLICIES } from "../http/rate-limit.js";

const tempDirs: string[] = [];
const originalRoot = process.env.ROOT;

async function appFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "agent-harness-agent-routes-"));
  tempDirs.push(root);
  process.env.ROOT = root;
  resetConfig();
  return { app: createApp(), root };
}

afterEach(async () => {
  vi.restoreAllMocks();
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent configuration routes", () => {
  it("preserves the stable malformed JSON envelope on the protected create boundary", async () => {
    const { app } = await appFixture();

    const first = await request(app)
      .post("/api/agents")
      .set("Content-Type", "application/json")
      .send('{"name":');

    expect(first.status).toBe(400);
    expect(first.body).toEqual({
      error: { code: "invalid_json", message: "Request body contains malformed JSON" },
    });

    let exhausted = first;
    for (let index = 1; index <= RATE_LIMIT_POLICIES.requestEnvelope.limit; index += 1) {
      exhausted = await request(app)
        .post("/api/agents")
        .set("Content-Type", "application/json")
        .send('{"name":');
    }
    expect(exhausted.status).toBe(429);
    expect(exhausted.body).toEqual({
      error: { code: "rate_limited", message: "Too many requests; retry later" },
    });
  });

  it("preserves the stable oversized envelope on the protected create boundary", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "agent-harness-agent-routes-"));
    tempDirs.push(root);
    process.env.ROOT = root;
    resetConfig();

    const app = createApp({ jsonLimit: "1kb" });
    const first = await request(app)
      .post("/api/agents")
      .send({ name: "oversized", model: "test-model", instructions: "x".repeat(2_000) });

    expect(first.status).toBe(413);
    expect(first.body).toEqual({
      error: { code: "request_too_large", message: "Request body exceeds maximum size" },
    });

    let exhausted = first;
    for (let index = 1; index <= RATE_LIMIT_POLICIES.requestEnvelope.limit; index += 1) {
      exhausted = await request(app)
        .post("/api/agents")
        .send({ name: "oversized", model: "test-model", instructions: "x".repeat(2_000) });
    }
    expect(exhausted.status).toBe(429);
    expect(exhausted.body).toEqual({
      error: { code: "rate_limited", message: "Too many requests; retry later" },
    });
  });

  it("returns the stable rate-limit envelope before an exhausted create route writes", async () => {
    const { app, root } = await appFixture();
    const requests = Array.from({ length: 31 }, (_, index) =>
      request(app)
        .post("/api/agents")
        .send({ name: `limited-${index}`, model: "test-model", tools: [] }),
    );

    const responses = [];
    for (const pending of requests) responses.push(await pending);

    expect(responses.slice(0, 30).every((response) => response.status === 201)).toBe(true);
    expect(responses[30]?.status).toBe(429);
    expect(responses[30]?.body).toEqual({
      error: { code: "rate_limited", message: "Too many requests; retry later" },
    });
    await expect(readFile(path.join(root, "agents", "limited-30.md"), "utf8")).rejects.toThrow();
  });

  it("creates an agent with an empty tool list without leaving an invalid file", async () => {
    const { app, root } = await appFixture();

    const created = await request(app)
      .post("/api/agents")
      .send({
        name: "researcher",
        model: "test-model",
        tools: [],
        maxSteps: 10,
        instructions: "Research carefully.",
        description: "Research specialist",
        capabilities: { chat: true },
        modelIdMapping: "mapped-test-model",
      });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "researcher",
      tools: [],
      description: "Research specialist",
      capabilities: { chat: true },
      modelIdMapping: "mapped-test-model",
    });
    const listed = await request(app).get("/api/agents");
    expect(listed.status).toBe(200);
    expect(listed.body).toEqual([
      expect.objectContaining({
        name: "researcher",
        tools: [],
        description: "Research specialist",
      }),
    ]);
    await expect(readFile(path.join(root, "agents", "researcher.md"), "utf8")).resolves.toContain(
      "Research carefully.",
    );
  });

  it("merges partial updates with the existing validated agent", async () => {
    const { app } = await appFixture();
    await request(app)
      .post("/api/agents")
      .send({
        name: "researcher",
        model: "original-model",
        tools: ["grep"],
        maxSteps: 7,
        instructions: "Original instructions.",
      });

    const updated = await request(app).put("/api/agents/researcher").send({ maxSteps: 12 });

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: "researcher",
      model: "original-model",
      tools: ["grep"],
      maxSteps: 12,
      instructions: "Original instructions.",
    });
  });

  it("round-trips validated raw source without client-side YAML parsing", async () => {
    const { app, root } = await appFixture();
    await request(app)
      .post("/api/agents")
      .send({
        name: "researcher",
        model: "original-model",
        tools: ["grep"],
        maxSteps: 7,
        instructions: "Original instructions.",
        description: "remove me",
      });
    const source = `---
# comments and quoted YAML are preserved
name: researcher
model: "updated-model"
tools: []
maxSteps: 9
---
Updated instructions.
`;

    const updated = await request(app).put("/api/agents/researcher/source").send({ source });
    const fetched = await request(app).get("/api/agents/researcher/source");

    expect(updated.status).toBe(200);
    expect(updated.body).toMatchObject({
      name: "researcher",
      model: "updated-model",
      tools: [],
      maxSteps: 9,
      instructions: "Updated instructions.",
    });
    expect(updated.body).not.toHaveProperty("description");
    expect(fetched.body).toEqual({ source });
    await expect(readFile(path.join(root, "agents", "researcher.md"), "utf8")).resolves.toBe(
      source,
    );
  });

  it("rejects an agent source path retargeted after open", async () => {
    const { app, root } = await appFixture();
    await request(app).post("/api/agents").send({
      name: "researcher",
      model: "model",
      tools: [],
      maxSteps: 7,
      instructions: "Original.",
    });
    const agentsLink = path.join(root, "agents");
    const first = path.join(root, "first-agents");
    const second = path.join(root, "second-agents");
    await rename(agentsLink, first);
    await mkdir(second);
    await writeFile(
      path.join(second, "researcher.md"),
      "---\nname: researcher\nmodel: model\ntools: []\nmaxSteps: 7\n---\nSecond secret.",
      "utf8",
    );
    await symlink(first, agentsLink, process.platform === "win32" ? "junction" : "dir");
    const open = fs.promises.open.bind(fs.promises);
    vi.spyOn(fs.promises, "open").mockImplementationOnce(async (filePath, flags, mode) => {
      const handle = await open(filePath, flags, mode);
      await rm(agentsLink);
      await symlink(second, agentsLink, process.platform === "win32" ? "junction" : "dir");
      return handle;
    });

    const response = await request(app).get("/api/agents/researcher/source");

    expect(response.status).toBe(403);
    expect(response.text).not.toContain("secret");
  });

  it("rejects raw source whose identity disagrees with the route", async () => {
    const { app } = await appFixture();
    await request(app).post("/api/agents").send({
      name: "researcher",
      model: "model",
      tools: [],
      maxSteps: 7,
      instructions: "Original.",
    });

    const response = await request(app).put("/api/agents/researcher/source").send({
      source: "---\nname: other\nmodel: model\ntools: []\nmaxSteps: 7\n---\nChanged.",
    });

    expect(response.status).toBe(400);
  });

  it("rejects malformed YAML as invalid source", async () => {
    const { app } = await appFixture();
    await request(app).post("/api/agents").send({
      name: "researcher",
      model: "model",
      tools: [],
      maxSteps: 7,
      instructions: "Original.",
    });

    const response = await request(app).put("/api/agents/researcher/source").send({
      source: "---\nname: [unterminated\n---\nChanged.",
    });

    expect(response.status).toBe(400);
    expect(response.body).toEqual({
      error: { code: "invalid_request", message: "Agent source is invalid" },
    });
  });

  it("returns 404 for non-existent agent across routes", async () => {
    const { app } = await appFixture();

    expect((await request(app).get("/api/agents/nonexistent")).status).toBe(404);
    expect((await request(app).get("/api/agents/nonexistent/source")).status).toBe(404);
    expect(
      (
        await request(app)
          .put("/api/agents/nonexistent/source")
          .send({ source: "---\nname: nonexistent\nmodel: m\ntools: []\nmaxSteps: 1\n---\n" })
      ).status,
    ).toBe(404);
    expect((await request(app).put("/api/agents/nonexistent").send({ maxSteps: 5 })).status).toBe(
      404,
    );
    expect((await request(app).delete("/api/agents/nonexistent")).status).toBe(404);
  });

  it("returns 409 when creating an agent that already exists", async () => {
    const { app } = await appFixture();
    await request(app).post("/api/agents").send({
      name: "existing",
      model: "test-model",
      tools: [],
      maxSteps: 10,
      instructions: "First creation.",
    });

    const duplicate = await request(app).post("/api/agents").send({
      name: "existing",
      model: "test-model",
      tools: [],
      maxSteps: 10,
      instructions: "Second creation.",
    });

    expect(duplicate.status).toBe(409);
    expect(duplicate.body).toEqual({ error: "Agent already exists" });
  });

  it("deletes an agent and returns 204", async () => {
    const { app } = await appFixture();
    await request(app).post("/api/agents").send({
      name: "to-delete",
      model: "test-model",
      tools: [],
      maxSteps: 10,
      instructions: "Delete me.",
    });

    const delRes = await request(app).delete("/api/agents/to-delete");
    expect(delRes.status).toBe(204);

    const getRes = await request(app).get("/api/agents/to-delete");
    expect(getRes.status).toBe(404);
  });

  it("atomically handles concurrent creations of the same agent name with one 201 and one 409", async () => {
    const { app } = await appFixture();
    const [res1, res2] = await Promise.all([
      request(app).post("/api/agents").send({
        name: "concurrent-agent",
        model: "test-model",
        tools: [],
        maxSteps: 10,
        instructions: "A",
      }),
      request(app).post("/api/agents").send({
        name: "concurrent-agent",
        model: "test-model",
        tools: [],
        maxSteps: 10,
        instructions: "B",
      }),
    ]);

    const statuses = [res1.status, res2.status].sort();
    expect(statuses).toEqual([201, 409]);
  });
});
