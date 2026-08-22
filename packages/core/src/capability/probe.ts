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
    timeoutMs: z.number().int().min(100).max(120_000).default(10_000),
    maxRetries: z.number().int().min(0).max(5).default(PROBE_MAX_RETRIES),
  })
  .strict();
export type ProbeOptions = z.input<typeof ProbeOptionsSchema>;

export async function probeCapabilities(options: ProbeOptions): Promise<CapabilityMatrix> {
  const { baseUrl, apiKey, model, timeoutMs, maxRetries } = parseBoundary(
    ProbeOptionsSchema,
    options,
    "capability probe options",
  );

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return parseBoundary(
        CapabilityMatrixSchema,
        await probeOnce(baseUrl, apiKey, model, timeoutMs),
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
  timeoutMs: number,
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

  caps.chat = await testChat(baseUrl, apiKey, model, timeoutMs);
  if (!caps.chat) return caps;

  const [tools, vision, streaming] = await Promise.all([
    testTools(baseUrl, apiKey, model, timeoutMs),
    testVision(baseUrl, apiKey, model, timeoutMs),
    testStreaming(baseUrl, apiKey, model, timeoutMs),
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
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return releaseResponse(res);
  } catch {
    return false;
  }
}

async function testTools(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Call test" }],
        tools: [
          {
            type: "function",
            function: {
              name: "test_tool",
              description: "A test tool",
              parameters: { type: "object", properties: {} },
            },
          },
        ],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return releaseResponse(res);
  } catch {
    return false;
  }
}

async function testVision(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [
          {
            role: "user",
            content: [
              { type: "text", text: "Describe this" },
              {
                type: "image_url",
                image_url: {
                  url: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
                },
              },
            ],
          },
        ],
        max_tokens: 50,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return releaseResponse(res);
  } catch {
    return false;
  }
}

async function testStreaming(
  baseUrl: string,
  apiKey: string,
  model: string,
  timeoutMs: number,
): Promise<boolean> {
  try {
    const res = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: "Hi" }],
        max_tokens: 5,
        stream: true,
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    return releaseResponse(res);
  } catch {
    return false;
  }
}

async function releaseResponse(response: Response): Promise<boolean> {
  const succeeded = response.ok;
  try {
    await response.body?.cancel();
  } catch {}
  return succeeded;
}
