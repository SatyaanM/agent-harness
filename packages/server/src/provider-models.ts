import type { ProviderEntry } from "@agent-harness/core";
import { parseJsonResponseBoundary } from "@agent-harness/core";
import { z } from "zod";

const ModelIdSchema = z.string().min(1).max(512);
const OpenAIModelsSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: ModelIdSchema,
            object: z.string().max(128).optional(),
            created: z.number().finite().optional(),
            owned_by: z.string().max(512).optional(),
          })
          .passthrough(),
      )
      .max(10_000),
  })
  .passthrough();
const AnthropicModelsSchema = z
  .object({
    data: z
      .array(
        z
          .object({
            id: ModelIdSchema,
            type: z.literal("model"),
            display_name: z.string().max(512),
            created_at: z.string().datetime(),
          })
          .passthrough(),
      )
      .max(10_000),
  })
  .passthrough();

export interface PublicProviderModel {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

type ProviderFetch = (input: string, init?: RequestInit) => Promise<Response>;

export async function fetchProviderModels(
  provider: ProviderEntry,
  fetcher: ProviderFetch = fetch,
): Promise<PublicProviderModel[]> {
  const apiKey = process.env[provider.apiKeyEnv];
  const headers: Record<string, string> = { Accept: "application/json" };
  if (provider.protocol === "anthropic") {
    headers["anthropic-version"] = "2023-06-01";
    if (apiKey) headers["x-api-key"] = apiKey;
  } else if (apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  }

  const response = await fetcher(`${provider.baseUrl.replace(/\/$/u, "")}/models`, {
    headers,
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Provider ${provider.id} model discovery returned ${response.status}`);
  }

  if (provider.protocol === "anthropic") {
    const body = await parseJsonResponseBoundary(
      response,
      AnthropicModelsSchema,
      `models response ${provider.id}`,
      2_000_000,
    );
    return body.data.map((model) => ({
      id: model.id,
      object: model.type,
      created: Math.floor(Date.parse(model.created_at) / 1000),
      owned_by: "Anthropic",
    }));
  }

  const body = await parseJsonResponseBoundary(
    response,
    OpenAIModelsSchema,
    `models response ${provider.id}`,
    2_000_000,
  );
  return body.data.map((model) => ({
    id: model.id,
    object: model.object ?? "model",
    created: model.created ?? 0,
    owned_by: model.owned_by ?? provider.displayName,
  }));
}
