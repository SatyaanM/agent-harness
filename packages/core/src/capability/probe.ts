import { z } from "zod";
import { type CapabilityMatrix, CapabilityMatrixSchema } from "../agent/types.js";
import { parseBoundary } from "../validation.js";

const PROBE_MAX_RETRIES = 2;
const PROBE_RETRY_BASE_DELAY_MS = 100;
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
  onOutcome?: (outcome: "success" | "unsupported" | "admission-denied" | "rejected") => void;
  onTransientExhausted?: (status: number | undefined) => void;
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

  return parseBoundary(
    CapabilityMatrixSchema,
    await probeOnce(baseUrl, apiKey, model, protocol, timeoutMs, maxRetries, hooks),
    "capability probe result",
  );
}

async function probeOnce(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  maxRetries: number,
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
    contextWindowTokens: 0,
    maxTokens: 0,
  };

  caps.chat = await testChat(baseUrl, apiKey, model, protocol, timeoutMs, maxRetries, hooks);
  if (!caps.chat) return caps;

  caps.tools = await testTools(baseUrl, apiKey, model, protocol, timeoutMs, maxRetries, hooks);
  caps.vision = await testVision(baseUrl, apiKey, model, protocol, timeoutMs, maxRetries, hooks);
  caps.streaming = await testStreaming(
    baseUrl,
    apiKey,
    model,
    protocol,
    timeoutMs,
    maxRetries,
    hooks,
  );

  return caps;
}

async function testChat(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  maxRetries: number,
  hooks: ProbeHooks,
): Promise<boolean> {
  return sendProbeRequest(
    baseUrl,
    apiKey,
    protocol,
    timeoutMs,
    { model, messages: [{ role: "user", content: "Hi" }], max_tokens: 5 },
    maxRetries,
    hooks,
  );
}

async function testTools(
  baseUrl: string,
  apiKey: string,
  model: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  maxRetries: number,
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
      maxRetries,
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
  maxRetries: number,
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
      maxRetries,
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
  maxRetries: number,
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
    maxRetries,
    hooks,
  );
}

async function sendProbeRequest(
  baseUrl: string,
  apiKey: string,
  protocol: "openai" | "anthropic",
  timeoutMs: number,
  body: Record<string, unknown>,
  maxRetries: number,
  hooks: ProbeHooks,
): Promise<boolean> {
  const serializedBody = JSON.stringify(body);
  const maximumOutputTokens =
    typeof body.max_tokens === "number" && Number.isFinite(body.max_tokens) ? body.max_tokens : 0;
  const estimatedTokens = Math.max(1, Math.ceil(serializedBody.length / 4)) + maximumOutputTokens;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    if (hooks.beforeRequest && !hooks.beforeRequest(estimatedTokens)) {
      hooks.onOutcome?.("admission-denied");
      return false;
    }
    try {
      const response = await fetch(probeUrl(baseUrl, protocol), {
        method: "POST",
        headers: probeHeaders(protocol, apiKey),
        body: serializedBody,
        signal: AbortSignal.timeout(timeoutMs),
      });
      const succeeded = response.ok;
      hooks.onResponse?.(response.status, succeeded);
      await releaseResponse(response);
      if (succeeded) {
        hooks.onOutcome?.("success");
        return true;
      }
      if (isTransientProbeStatus(response.status)) {
        if (attempt < maxRetries) {
          await retryDelay(attempt);
          continue;
        }
        hooks.onTransientExhausted?.(response.status);
        return false;
      }
      const outcome = isStableUnsupportedStatus(response.status) ? "unsupported" : "rejected";
      hooks.onOutcome?.(outcome);
      return false;
    } catch {
      if (attempt < maxRetries) {
        await retryDelay(attempt);
        continue;
      }
      hooks.onTransientExhausted?.(undefined);
      return false;
    }
  }
  return false;
}

function isTransientProbeStatus(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

function isStableUnsupportedStatus(status: number): boolean {
  return status === 400 || status === 404 || status === 405 || status === 415 || status === 422;
}

async function retryDelay(attempt: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, PROBE_RETRY_BASE_DELAY_MS * 2 ** attempt));
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

async function releaseResponse(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {}
}
