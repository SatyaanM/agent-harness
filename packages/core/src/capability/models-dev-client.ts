import type { CapabilityMatrix } from "../agent/types.js";
import { parseJsonResponseBoundary } from "../contracts/http.js";
import { type ModelsDevResponse, ModelsDevResponseSchema } from "./types.js";

const API_URL = "https://models.dev/api.json";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;
const REQUEST_TIMEOUT_MS = 10_000;
const MAX_RESPONSE_BYTES = 5_000_000;

let cachedApi: ModelsDevResponse | null = null;
let fetchFailed = false;
let pendingFetch: Promise<ModelsDevResponse | null> | null = null;

function isTransientError(status: number | undefined): boolean {
  if (!status) return true;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchApi(): Promise<ModelsDevResponse | null> {
  if (fetchFailed) return null;
  if (cachedApi) return cachedApi;
  if (!pendingFetch) {
    pendingFetch = (async () => {
      for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
        const delay = BASE_DELAY_MS * 2 ** Math.max(0, attempt - 1);
        if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, delay));
        let response: Response;
        try {
          response = await fetch(API_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
        } catch {
          continue;
        }
        if (response.ok) {
          try {
            cachedApi = await parseJsonResponseBoundary(
              response,
              ModelsDevResponseSchema,
              "models.dev response",
              MAX_RESPONSE_BYTES,
            );
            return cachedApi;
          } catch {
            break;
          }
        }
        await response.body?.cancel();
        if (!isTransientError(response.status)) break;
      }
      fetchFailed = true;
      return null;
    })().finally(() => {
      pendingFetch = null;
    });
  }
  return pendingFetch;
}

export function resetModelsDevCache(): void {
  cachedApi = null;
  fetchFailed = false;
  pendingFetch = null;
}

function normalizeId(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.\-_/]/g, "");
}

export async function fetchCapabilities(
  provider: string,
  model: string,
  correlatedId: string,
): Promise<CapabilityMatrix | null> {
  const api = await fetchApi();
  if (!api) return null;

  const candidates = [correlatedId, `${provider}/${model}`, model].map(normalizeId);

  let entry: ModelsDevResponse[string]["models"][string] | undefined;
  for (const [providerKey, providerEntry] of Object.entries(api)) {
    for (const [modelKey, modelEntry] of Object.entries(providerEntry.models)) {
      const identifiers = [
        modelKey,
        `${providerKey}/${modelKey}`,
        modelEntry.id,
        modelEntry.id ? `${providerKey}/${modelEntry.id}` : undefined,
      ]
        .filter((identifier): identifier is string => identifier !== undefined)
        .map(normalizeId);
      if (identifiers.some((identifier) => candidates.includes(identifier))) {
        entry = modelEntry;
        break;
      }
    }
    if (entry) break;
  }

  if (!entry) return null;

  return {
    chat: true,
    tools: entry.tool_call === true,
    vision: (entry.modalities?.input ?? []).includes("image"),
    streaming: true,
    maxTokens: entry.limit?.output ?? 0,
  };
}
