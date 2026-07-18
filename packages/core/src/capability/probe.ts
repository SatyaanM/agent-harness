import type { CapabilityMatrix } from "../agent/types.js";

export interface ProbeOptions {
  baseUrl: string;
  apiKey: string;
  model: string;
  timeoutMs?: number;
  maxRetries?: number;
}

const PROBE_MAX_RETRIES = 2;

export async function probeCapabilities(
  options: ProbeOptions,
): Promise<CapabilityMatrix> {
  const { baseUrl, apiKey, model, timeoutMs = 10_000, maxRetries = PROBE_MAX_RETRIES } = options;

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await probeOnce(baseUrl, apiKey, model, timeoutMs);
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      if (attempt < maxRetries) {
        const delay = 1000 * Math.pow(2, attempt);
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

async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
): Promise<T | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const result = await promise;
    return result;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
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
    return res.ok;
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
    return res.ok;
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
    return res.ok;
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
    return res.ok;
  } catch {
    return false;
  }
}
