import type { CapabilityMatrix } from "../agent/types.js";
import type { ModelsDevResponse } from "./types.js";

const API_URL = "https://models.dev/api.json";
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000;

let cachedApi: ModelsDevResponse | null = null;
let fetchFailed = false;

function isTransientError(status: number | undefined): boolean {
  if (!status) return true;
  return status === 429 || status === 502 || status === 503 || status === 504;
}

async function fetchWithRetry(url: string, attempt: number): Promise<Response> {
  const res = await fetch(url);
  if (!res.ok && isTransientError(res.status) && attempt < MAX_RETRIES) {
    const delay = BASE_DELAY_MS * 2 ** attempt;
    await new Promise((resolve) => setTimeout(resolve, delay));
    return fetchWithRetry(url, attempt + 1);
  }
  return res;
}

async function fetchApi(): Promise<ModelsDevResponse | null> {
  if (fetchFailed) return null;
  if (cachedApi) return cachedApi;
  try {
    const res = await fetchWithRetry(API_URL, 0);
    if (!res.ok) {
      fetchFailed = true;
      return null;
    }
    cachedApi = (await res.json()) as ModelsDevResponse;
    return cachedApi;
  } catch {
    if (fetchFailed) return null;
    try {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const delay = BASE_DELAY_MS * 2 ** attempt;
        await new Promise((resolve) => setTimeout(resolve, delay));
        try {
          const res = await fetch(API_URL);
          if (res.ok) {
            cachedApi = (await res.json()) as ModelsDevResponse;
            return cachedApi;
          }
          if (!isTransientError(res.status)) break;
        } catch {
          if (attempt === MAX_RETRIES - 1) {
            fetchFailed = true;
            return null;
          }
        }
      }
    } catch {
      fetchFailed = true;
    }
    fetchFailed = true;
    return null;
  }
}

export function resetModelsDevCache(): void {
  cachedApi = null;
  fetchFailed = false;
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

  let entry: ModelsDevResponse[string] | undefined;
  for (const key of Object.keys(api)) {
    const normalized = normalizeId(key);
    if (
      candidates.includes(normalized) ||
      candidates.includes(normalizeId(key.split("/").pop() ?? ""))
    ) {
      entry = api[key];
      break;
    }
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
