import { resetConfig } from "@agent-harness/core";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { sessionManager } from "./session-manager.js";

const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ORIGINAL_OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetConfig();
  if (ORIGINAL_GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI_API_KEY;
  if (ORIGINAL_OPENCODE_API_KEY === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = ORIGINAL_OPENCODE_API_KEY;
});

describe("GET /api/health", () => {
  it("returns status ok", async () => {
    const res = await request(createApp()).get("/api/health");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: "ok" });
  });

  it("reports bounded runtime execution metrics", async () => {
    const res = await request(createApp()).get("/api/metrics");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      agentExecutions: expect.objectContaining({ active: 0, limit: 10, queued: 0 }),
      loadedSessions: expect.any(Number),
      activeWorkers: expect.any(Number),
    });
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

  it("returns a stable error for malformed JSON without exposing parser details", async () => {
    const res = await request(createApp())
      .post("/api/chat")
      .set("Content-Type", "application/json")
      .send('{"sessionId":');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: { code: "invalid_json", message: "Request body contains malformed JSON" },
    });
  });

  it("returns a stable 413 envelope for oversized JSON", async () => {
    const res = await request(createApp({ jsonLimit: "1kb" }))
      .post("/api/chat")
      .send({ sessionId: "safe-session", message: "x".repeat(2_000) });

    expect(res.status).toBe(413);
    expect(res.body).toEqual({
      error: { code: "request_too_large", message: "Request body exceeds maximum size" },
    });
  });
});

describe("browser origin policy", () => {
  it("allows configured dashboard origins", async () => {
    const res = await request(createApp({ allowedOrigins: ["http://localhost:3000"] }))
      .get("/api/health")
      .set("Origin", "http://localhost:3000");

    expect(res.headers["access-control-allow-origin"]).toBe("http://localhost:3000");
  });

  it("does not grant CORS access to an untrusted origin", async () => {
    const res = await request(createApp({ allowedOrigins: ["http://localhost:3000"] }))
      .get("/api/health")
      .set("Origin", "https://attacker.example");

    expect(res.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("upstream trust boundaries", () => {
  it("validates provider model responses before returning them", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ object: "list", data: [{ id: 42 }] }))),
    );

    const res = await request(createApp()).get("/api/settings/models");

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Failed to fetch models" });
  });

  it("does not return provider failure details to clients", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider-secret", { status: 500 })),
    );

    const res = await request(createApp()).get("/api/settings/models");

    expect(res.status).toBe(502);
    expect(res.text).not.toContain("provider-secret");
  });

  it("does not expose agent failures through the chat stream", async () => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(sessionManager, "getOrCreate").mockImplementation(() => {
      throw new Error("provider-secret");
    });

    const res = await request(createApp())
      .post("/api/chat")
      .send({ sessionId: "safe-session", message: "hello" });

    expect(res.status).toBe(200);
    expect(res.text).toContain("Agent request failed");
    expect(res.text).not.toContain("provider-secret");
  });

  it("does not expose voice-provider failures", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    delete process.env.OPENCODE_API_KEY;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("provider-secret", { status: 500 })),
    );

    const res = await request(createApp()).post("/api/tts").send({ text: "hello" });

    expect(res.status).toBe(502);
    expect(res.body).toEqual({ error: "Voice generation failed" });
    expect(res.text).not.toContain("provider-secret");
  });
});
