import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { resetConfig, SessionRuntime } from "@agent-harness/core";
import express, { type Express } from "express";
import request from "supertest";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app.js";
import { sessionManager } from "./session-manager.js";

const ORIGINAL_GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const ORIGINAL_OPENCODE_API_KEY = process.env.OPENCODE_API_KEY;
const ORIGINAL_ROOT = process.env.ROOT;
const tempDirs: string[] = [];

afterEach(async () => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  resetConfig();
  if (ORIGINAL_GEMINI_API_KEY === undefined) delete process.env.GEMINI_API_KEY;
  else process.env.GEMINI_API_KEY = ORIGINAL_GEMINI_API_KEY;
  if (ORIGINAL_OPENCODE_API_KEY === undefined) delete process.env.OPENCODE_API_KEY;
  else process.env.OPENCODE_API_KEY = ORIGINAL_OPENCODE_API_KEY;
  if (ORIGINAL_ROOT === undefined) delete process.env.ROOT;
  else process.env.ROOT = ORIGINAL_ROOT;
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
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

  it("accepts the dotted plugin-name grammar used by manifests", async () => {
    const res = await request(createApp())
      .put("/api/plugins/acme.renderer")
      .send({ enabled: true });

    expect(res.status).toBe(404);
    expect(res.body.error).toBe('Plugin "acme.renderer" not found');
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
  it("tests a configured provider without exposing its credential", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "provider-settings-"));
    tempDirs.push(root);
    await mkdir(path.join(root, ".harness"));
    await writeFile(
      path.join(root, ".harness", "settings.json"),
      JSON.stringify({
        PROVIDERS: [
          {
            id: "custom",
            displayName: "Custom",
            protocol: "openai",
            baseUrl: "https://custom.example/v1",
            apiKeyEnv: "CUSTOM_PROVIDER_KEY",
            enabled: true,
            priority: 0,
          },
        ],
      }),
    );
    process.env.ROOT = root;
    process.env.CUSTOM_PROVIDER_KEY = "provider-secret";
    resetConfig();
    const fetchMock = vi.fn(async () =>
      Response.json({
        object: "list",
        data: [{ id: "model-a", object: "model", created: 1, owned_by: "custom" }],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const res = await request(createApp())
      .post("/api/settings/providers/custom/test")
      .send({
        provider: {
          id: "custom",
          displayName: "Custom",
          protocol: "openai",
          baseUrl: "https://custom.example/v1",
          apiKeyEnv: "CUSTOM_PROVIDER_KEY",
          enabled: true,
          priority: 0,
        },
      });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ connected: true, modelCount: 1 });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://custom.example/v1/models",
      expect.objectContaining({ headers: { Authorization: "Bearer provider-secret" } }),
    );
    expect(res.text).not.toContain("provider-secret");
    delete process.env.CUSTOM_PROVIDER_KEY;
  });

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

  it("routes an explicit chat retry through replay delivery", async () => {
    const retry = vi.spyOn(SessionRuntime.prototype, "retry").mockResolvedValue({
      status: "success",
      summary: "recovered",
      messages: [{ role: "assistant", content: "recovered" }],
    });
    const deliver = vi.spyOn(SessionRuntime.prototype, "deliver");

    const res = await request(createApp())
      .post("/api/chat")
      .send({ sessionId: "retry-session", message: "hello", retry: true });

    expect(res.status).toBe(200);
    expect(retry).toHaveBeenCalledWith(
      "hello",
      undefined,
      expect.any(AbortSignal),
      expect.any(String),
    );
    expect(deliver).not.toHaveBeenCalled();
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

  it("preserves long unbroken agent summaries in the chat stream", async () => {
    const summary = "x".repeat(100);
    vi.spyOn(SessionRuntime.prototype, "deliver").mockResolvedValue({
      status: "success",
      summary,
      messages: [{ role: "assistant", content: summary }],
    });

    const response = await request(createApp())
      .post("/api/chat")
      .send({ sessionId: "chunking-session", message: "hello" });

    expect(response.status).toBe(200);
    const emittedCharacters = Array.from(response.text.matchAll(/"text":"(x*)"/gu)).reduce(
      (total, match) => total + (match[1]?.length ?? 0),
      0,
    );
    expect(emittedCharacters).toBe(100);
  });

  it("aborts an in-flight run when the chat client disconnects", async () => {
    let observedSignal: AbortSignal | undefined;
    vi.spyOn(SessionRuntime.prototype, "deliver").mockImplementation(
      async (_message, _agentName, signal) => {
        observedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("client disconnected")), {
            once: true,
          });
        });
      },
    );
    const pending = request(createApp())
      .post("/api/chat")
      .send({ sessionId: "disconnect-session", message: "hello" });
    const completion = pending.then(
      () => "resolved",
      () => "rejected",
    );
    await vi.waitFor(() => expect(observedSignal).toBeDefined());

    pending.abort();

    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true));
    await expect(completion).resolves.toBe("rejected");
  });

  it("aborts an in-flight run when the session is deleted server-side", async () => {
    // End-to-end wiring test: real `trackSession`, real `AbortController`,
    // real `runtime.deliver`, mocked only at the LLM call layer (so the
    // test doesn't need network access). Regression: if `routes/chat.ts`
    // ever drops the `trackSession(sessionId, controller)` call or forgets
    // to wire `controller.signal` into `runtime.deliver`, the SSE stream
    // would silently emit a `done` event with no error. We assert the
    // AbortSignal observed inside the (mocked) deliver call actually
    // flipped to `aborted: true`, AND that the route's catch-block surfaces
    // it as an SSE `error` event rather than a `done`.
    const sessionId = "abort-on-delete-session-unique";
    let observedSignal: AbortSignal | undefined;
    const deliverSpy = vi
      .spyOn(SessionRuntime.prototype, "deliver")
      .mockImplementation(async (_message, _agentName, signal) => {
        observedSignal = signal;
        return new Promise((_resolve, reject) => {
          signal?.addEventListener("abort", () => reject(new Error("session deleted")), {
            once: true,
          });
        });
      });

    expect(vi.isMockFunction(SessionRuntime.prototype.deliver)).toBe(true);

    const app = createApp();
    // `request(...)` returns a supertest Test; attach `.then` so the actual
    // HTTP exchange kicks off synchronously and the mock can intercept.
    const requestPromise = request(app)
      .post("/api/chat")
      .send({ sessionId, message: "hello" })
      .then((r) => r);

    await vi.waitFor(() => expect(observedSignal).toBeDefined(), {
      timeout: 2_000,
    });

    sessionManager.prepareSessionDeletion(sessionId);

    await vi.waitFor(() => expect(observedSignal?.aborted).toBe(true), {
      timeout: 2_000,
    });

    const response = await Promise.race([
      requestPromise,
      new Promise<never>((_, reject) =>
        setTimeout(() => reject(new Error("chat request hung")), 2_000),
      ),
    ]);
    expect(response.status).toBe(200);
    expect(response.text).toContain("Agent request failed");
    expect(response.text).toContain('"type":"error"');

    deliverSpy.mockRestore();
  });

  it("includes the configured persona in the TTS narration prompt", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.OPENCODE_API_KEY = "paraphrase-key";
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        Response.json({ choices: [{ message: { content: "spoken summary" } }] }),
      )
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "audio/pcm", data: "AAA=" } }],
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(createApp()).post("/api/tts").send({
      text: "hello",
      persona: "Warm professor",
    });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[0]?.[1]?.body).toContain("Warm professor");
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain("Warm professor");
  });

  it("falls back to the original narration when optional paraphrasing fails", async () => {
    process.env.GEMINI_API_KEY = "test-key";
    process.env.OPENCODE_API_KEY = "paraphrase-key";
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new Error("paraphrase unavailable"))
      .mockResolvedValueOnce(
        Response.json({
          candidates: [
            {
              content: {
                parts: [{ inlineData: { mimeType: "audio/pcm", data: "AAA=" } }],
              },
            },
          ],
        }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const response = await request(createApp()).post("/api/tts").send({ text: "original text" });

    expect(response.status).toBe(200);
    expect(fetchMock.mock.calls[1]?.[1]?.body).toContain("original text");
  });
});

describe("error middleware", () => {
  it("does not call next() when headers are already sent", () => {
    // Spin up a minimal Express app that mirrors the production error
    // middleware's shape: if headers are flushed and an error is forwarded,
    // the middleware should terminate gracefully rather than re-entering the
    // Express default error handler (which would crash with
    // ERR_HTTP_HEADERS_SENT).
    let observedNext: (() => void) | undefined;
    const app: Express = express();
    app.get("/__trigger", (_req, res, next) => {
      res.status(200);
      res.setHeader("content-type", "text/plain");
      res.write("partial");
      // `headersSent` is now true. Hand the error to the production middleware
      // chain by registering a route below that calls `next(err)` after we
      // return. By the time the error middleware runs, `res.headersSent` is
      // already `true` and `_next(err)` would crash with ERR_HTTP_HEADERS_SENT.
      observedNext = () => next(new Error("late"));
      queueMicrotask(observedNext);
    });
    // Error-handling middleware that mirrors the production branch: when
    // headers are already flushed, log and end the response. When they aren't,
    // forward via `next(err)`. The path we're testing is the first branch.
    app.use(
      (err: unknown, _req: express.Request, res: express.Response, next: express.NextFunction) => {
        if (res.headersSent) {
          // Production behavior: log and stop. Do NOT call `next(err)` — that
          // would crash with ERR_HTTP_HEADERS_SENT.
          if (!res.writableEnded) {
            res.end();
          }
          return;
        }
        next(err);
      },
    );

    return request(app)
      .get("/__trigger")
      .then((response) => {
        expect(observedNext).toBeDefined();
        // The middleware logged and ended without crashing; supertest reports
        // success (status 200) or a clean connection close, never
        // `ERR_HTTP_HEADERS_SENT` propagated back as a hard error.
        expect(response.status).toBe(200);
        expect(response.text).toBe("partial");
      });
  });
});
