import { z } from "zod";
import { type CapabilityMatrix, CapabilityMatrixSchema } from "../agent/types.js";
import { parseBoundary } from "../validation.js";

const PROBE_MAX_RETRIES = 2;
const ProbeOptionsSchema = z
  .object({
    baseUrl: z
      .string()
      .min(1)
      .max(2_048)
      .url()
      .refine((value) => {
        const url = new URL(value);
        return (
          (url.protocol === "http:" || url.protocol === "https:") &&
          !url.username &&
          !url.password &&
          !url.search &&
          !url.hash
        );
      }, "must be an HTTP(S) URL without credentials, query, or fragment")
      .transform((value) => value.replace(/\/+$/u, "")),
    apiKey: z.string().min(1).max(16_384),
    model: z.string().min(1).max(512),
    protocol: z.enum(["openai", "anthropic"]).default("openai"),
    timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
    maxRetries: z.number().int().min(0).max(5).default(PROBE_MAX_RETRIES),
  })
  .strict();
export type ProbeOptions = z.input<typeof ProbeOptionsSchema>;

export interface ProbeHooks {
  beforeRequest?: (estimatedTokens: number) => boolean;
  onResponse?: (status: number, succeeded: boolean) => void;
}

export async function probeCapabilities(
  options: ProbeOptions,
  hooks: ProbeHooks = {},
): Promise<CapabilityMatrix> {
  const { baseUrl, apiKey, model, protocol, timeoutMs, maxRetries } = parseBoundary(
    ProbeOptionsSchema,
    options,
    "capability probe options",
  );

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return parseBoundary(
        CapabilityMatrixSchema,
        await probeOnce(baseUrl, apiKey, model, protocol, timeoutMs, hooks),
        "capability probe result",
      );
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = 1000 * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  throw new Error(
    `Probe failed after ${maxRetries + 1} attempts: ${lastError?.message ?? "unknown error"}`,
  );
}

async function probeOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  hooks: ProbeHooks,
): Promise<CapabilityMatrix> {
  const caps: CapabilityMatrix = {
    chat: false,
    tools: false,
    vision: false,
    streaming: false,
    structuredOutputs: false,
    promptCaching: false,
    reasoning: false,
    maxTokens: 0,
  };

  caps.chat = await testChat(baseUrl, apiKey, model, protocol, timeoutMs, hooks);
  if (!caps.chat) return caps;

  const [tools, vision, streaming] = await Promise.all([
    testTools(baseUrl, apiKey, model, protocol, timeoutMs, hooks),
    testVision(baseUrl, apiKey, model, protocol, timeoutMs, hooks),
    testStreaming(baseUrl, apiKey, model, protocol, timeoutMs, hooks),
  ]);

  caps.tools = tools;
  caps.vision = vision;
  caps.streaming = streaming;

  return caps;
}

async function testChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  hooks: ProbeHooks,
): Promise<boolean> {
  return sendProbeRequest(
    baseUrl,
    apiKey,
    protocol,
    timeoutMs,
    { model, messages: [{ role: "user", content: "Hi" }], max_tokens: 5 },
    hooks,
  );
}

async function testTools(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  hooks: ProbeHooks,
): Promise<boolean> {
  try {
    const tools =
      protocol === "anthropic"
        ? [
            {
              name: "test_tool",
              description: "A test tool",
              input_schema: { type: "object", properties: {} },
            },
          ]
        : [
            {
              type: "function",
              function: {
                name: "test_tool",
                description: "A test tool",
                parameters: { type: "object", properties: {} },
              },
            },
          ];
    return sendProbeRequest(
      baseUrl,
      apiKey,
      protocol,
      timeoutMs,
      { model, messages: [{ role: "user", content: "Call test" }], tools, max_tokens: 50 },
      hooks,
    );
  } catch {
    return false;
  }
}

async function testVision(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  hooks: ProbeHooks,
): Promise<boolean> {
  try {
    const imagePart =
      protocol === "anthropic"
        ? {
            type: "image",
            source: {
              type: "base64",
              media_type: "image/png",
              data: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          }
        : {
            type: "image_url",
            image_url: {
              url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
            },
          };
    return sendProbeRequest(
      baseUrl,
      apiKey,
      protocol,
      timeoutMs,
      {
        model,
        messages: [
          {
            role: "user",
            content: [{ type: "text", text: "Describe this" }, imagePart],
          },
        ],
        max_tokens: 50,
      },
      hooks,
    );
  } catch {
    return false;
  }
}

async function testStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  hooks: ProbeHooks,
): Promise<boolean> {
  return sendProbeRequest(
    baseUrl,
    apiKey,
    protocol,
    timeoutMs,
    {
      model,
      messages: [{ role: "user", content: "Hi" }],
      max_tokens: 5,
      stream: true,
    },
    hooks,
  );
}

async function sendProbeRequest(
  baseUrl: string,
  apiKey: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  body: Record<string, unknown>,
  hooks: ProbeHooks,
): Promise<boolean> {
  try {
    const serializedBody = JSON.stringify(body);
    const maximumOutputTokens =
      typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens) ? body.max_tokens : 0;
    const estimatedTokens = Math.max(1, Math.ceil(serializedBody.length / 4)) + maximumOutputTokens;
    if (hooks.beforeRequest && !hooks.beforeRequest(estimatedTokens)) return false;
    const response = await fetch(probeUrl(baseUrl, protocol), {
      method: "POST",
      headers: probeHeaders(protocol, apiKey),
      body: serializedBody,
      signal: AbortSignal.timeout(timeoutMs),
    });
    return releaseResponse(response, hooks);
  } catch {
    return false;
  }
}

function probeUrl(baseUrl: string, protocol: "openai" | "anthropic"): string {
  return `${baseUrl}/${protocol === "anthropic" ? "messages" : "chat/completions"}`;
}

function probeHeaders(protocol: "openai" | "anthropic", apiKey: string): Record<string, string> {
  if (protocol === "anthropic") {
    return {
      "Content-Type": "application/json",
      "anthropic-version": "2023-06-01",
      "x-api-key": apiKey,
    };
  }
  return { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
}

async function releaseResponse(response: Response, hooks: ProbeHooks): Promise<boolean> {
  const succeeded = response.ok;
  hooks.onResponse?.(response.status, succeeded);
  try {
    await response.body?.cancel();
  } catch {}
  return succeeded;
}
