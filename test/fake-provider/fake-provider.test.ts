import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createFakeProviderServer, type FakeServerInstance } from "./index.js";
import { resetScenarioCallCounts } from "./scenarios.js";

const HealthSchema = z.object({
  status: z.string(),
  provider: z.string(),
});

const ModelsSchema = z.object({
  object: z.string(),
  data: z.array(z.object({ id: z.string() })),
});

const OpenAIChatResponseSchema = z.object({
  choices: z.array(
    z.object({
      message: z.object({
        role: z.string(),
        content: z.string().nullable().optional(),
        tool_calls: z
          .array(
            z.object({
              id: z.string(),
              function: z.object({
                name: z.string(),
                arguments: z.string(),
              }),
            }),
          )
          .optional(),
      }),
      finish_reason: z.string(),
    }),
  ),
  usage: z.object({
    total_tokens: z.number(),
  }),
});

const AnthropicResponseSchema = z.object({
  type: z.string(),
  role: z.string(),
  content: z.array(z.object({ type: z.string(), text: z.string().optional() })),
  stop_reason: z.string(),
});

describe("Fake LLM Provider Service", () => {
  let fakeServer: FakeServerInstance;

  beforeEach(async () => {
    resetScenarioCallCounts();
    fakeServer = await createFakeProviderServer({ port: 0 });
  });

  afterEach(async () => {
    if (fakeServer) {
      await fakeServer.close();
    }
  });

  it("responds to /health endpoint", async () => {
    const res = await fetch(`${fakeServer.url}/health`);
    expect(res.status).toBe(200);
    const data = HealthSchema.parse(await res.json());
    expect(data.status).toBe("ok");
    expect(data.provider).toBe("fake-llm-service");
  });

  it("lists available models on /v1/models", async () => {
    const res = await fetch(`${fakeServer.url}/v1/models`);
    expect(res.status).toBe(200);
    const data = ModelsSchema.parse(await res.json());
    expect(data.object).toBe("list");
    expect(data.data.some((m) => m.id === "opencode-go/qwen3.7-plus")).toBe(true);
  });

  it("handles OpenAI /v1/chat/completions with simple-reply scenario", async () => {
    const res = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Hello world" }],
      }),
    });

    expect(res.status).toBe(200);
    const data = OpenAIChatResponseSchema.parse(await res.json());
    const firstChoice = data.choices[0];
    expect(firstChoice).toBeDefined();
    expect(firstChoice?.message.role).toBe("assistant");
    expect(firstChoice?.message.content).toContain("Deterministic reply");
    expect(firstChoice?.finish_reason).toBe("stop");
    expect(data.usage.total_tokens).toBeGreaterThan(0);
  });

  it("handles scenario matching via E2E_SCENARIO prefix in user prompt", async () => {
    const res = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Please run E2E_SCENARIO:tool-call-simple" }],
      }),
    });

    expect(res.status).toBe(200);
    const data = OpenAIChatResponseSchema.parse(await res.json());
    const firstChoice = data.choices[0];
    expect(firstChoice?.finish_reason).toBe("tool_calls");
    expect(firstChoice?.message.tool_calls?.[0]?.function.name).toBe("glob");
  });

  it("handles OpenAI streaming completions", async () => {
    const res = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "E2E_SCENARIO:streaming-reply" }],
        stream: true,
      }),
    });

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const raw = await res.text();
    expect(raw).toContain("data: ");
    expect(raw).toContain("[DONE]");
  });

  it("handles Anthropic /v1/messages protocol", async () => {
    const res = await fetch(`${fakeServer.url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "E2E_SCENARIO:simple-reply" }],
      }),
    });

    expect(res.status).toBe(200);
    const data = AnthropicResponseSchema.parse(await res.json());
    expect(data.type).toBe("message");
    expect(data.role).toBe("assistant");
    expect(data.content[0]?.type).toBe("text");
    expect(data.content[0]?.text).toContain("Deterministic reply");
    expect(data.stop_reason).toBe("end_turn");
  });

  it("simulates HTTP 429 rate limit then recovery on subsequent call", async () => {
    // First call: 429
    const res1 = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-scenario": "rate-limit-retry",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      }),
    });
    expect(res1.status).toBe(429);
    expect(res1.headers.get("retry-after")).toBe("1");

    // Second call: recovers with 200
    const res2 = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-scenario": "rate-limit-retry",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      }),
    });
    expect(res2.status).toBe(200);
    const data2 = OpenAIChatResponseSchema.parse(await res2.json());
    expect(data2.choices[0]?.message.content).toContain(
      "Recovery after rate limit retry succeeded",
    );
  });

  it("simulates HTTP 500 server error", async () => {
    const res = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-test-scenario": "server-error",
      },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [{ role: "user", content: "Test" }],
      }),
    });
    expect(res.status).toBe(500);
  });

  it("handles multipart array content in message prompt matching", async () => {
    const res = await fetch(`${fakeServer.url}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "gpt-4o",
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Please trigger E2E_SCENARIO:tool-call-simple" }],
          },
        ],
      }),
    });
    expect(res.status).toBe(200);
    const data = OpenAIChatResponseSchema.parse(await res.json());
    expect(data.choices[0]?.finish_reason).toBe("tool_calls");
  });

  it("handles Anthropic streaming with tool calls", async () => {
    const res = await fetch(`${fakeServer.url}/v1/messages`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "claude-3-5-sonnet-20241022",
        messages: [{ role: "user", content: "E2E_SCENARIO:tool-call-simple" }],
        stream: true,
      }),
    });
    expect(res.status).toBe(200);
    const raw = await res.text();
    expect(raw).toContain("tool_use");
    expect(raw).toContain("input_json_delta");
    expect(raw).toContain("message_stop");
  });
});
