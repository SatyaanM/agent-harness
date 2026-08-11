import request from "supertest";
import { describe, expect, it } from "vitest";
import { createApp } from "./app.js";

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });
});

describe("request boundary validation", () => {
  it("returns a stable 400 envelope for an invalid chat body", async () => {
    const res = await request(createApp()).post("/api/chat").send({ sessionId: 42, message: "hi" });

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: "invalid_request",
        message: "Request validation failed",
        issues: [expect.objectContaining({ path: "sessionId" })],
      },
    });
  });

  it("rejects path-like agent identifiers before filesystem access", async () => {
    const res = await request(createApp()).get("/api/agents/%5C..%5Csecret");

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(
      expect.objectContaining({ code: "invalid_request", message: "Request validation failed" }),
    );
  });

  it("rejects incorrect plugin mutation types", async () => {
    const res = await request(createApp()).put("/api/plugins/example").send({ enabled: "yes" });

    expect(res.status).toBe(400);
    expect(res.body.error).toEqual(expect.objectContaining({ code: "invalid_request" }));
  });
});
