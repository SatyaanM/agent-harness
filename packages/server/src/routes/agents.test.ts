import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig } from "@agent-harness/core";
import request from "supertest";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../app.js";

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
  if (originalRoot === undefined) delete process.env.ROOT;
  else process.env.ROOT = originalRoot;
  resetConfig();
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("agent configuration routes", () => {
  it("creates an agent with an empty tool list without leaving an invalid file", async () => {
    const { app, root } = await appFixture();

    const created = await request(app).post("/api/agents").send({
      name: "researcher",
      model: "test-model",
      tools: [],
      maxSteps: 10,
      instructions: "Research carefully.",
      description: "Research specialist",
    });

    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      name: "researcher",
      tools: [],
      description: "Research specialist",
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
