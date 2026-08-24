import type { ProviderEntry } from "@agent-harness/core";
import { describe, expect, it, vi } from "vitest";
import { fetchProviderModels } from "./provider-models.js";

function provider(protocol: "openai" | "anthropic"): ProviderEntry {
  return {
    id: protocol,
    displayName: protocol,
    protocol,
    baseUrl: `https://${protocol}.example/v1`,
    apiKeyEnv: `${protocol.toUpperCase()}_KEY`,
    enabled: true,
    priority: 0,
  };
}

describe("provider model discovery", () => {
  it("uses OpenAI bearer auth and normalizes its list envelope", async () => {
    process.env.OPENAI_KEY = "openai-secret";
    const fetcher = vi.fn(async () =>
      Response.json({
        object: "list",
        data: [{ id: "vendor/model", object: "model", created: 123, owned_by: "vendor" }],
      }),
    );

    await expect(fetchProviderModels(provider("openai"), fetcher)).resolves.toEqual([
      { id: "vendor/model", object: "model", created: 123, owned_by: "vendor" },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://openai.example/v1/models",
      expect.objectContaining({
        headers: { Accept: "application/json", Authorization: "Bearer openai-secret" },
      }),
    );
    delete process.env.OPENAI_KEY;
  });

  it("uses Anthropic headers and normalizes model metadata", async () => {
    process.env.ANTHROPIC_KEY = "anthropic-secret";
    const fetcher = vi.fn(async () =>
      Response.json({
        data: [
          {
            type: "model",
            id: "claude/sonnet",
            display_name: "Claude Sonnet",
            created_at: "2025-02-19T00:00:00Z",
          },
        ],
        has_more: false,
        first_id: "claude/sonnet",
        last_id: "claude/sonnet",
      }),
    );

    const result = await fetchProviderModels(provider("anthropic"), fetcher);
    expect(result).toEqual([
      {
        id: "claude/sonnet",
        object: "model",
        created: 1_739_923_200,
        owned_by: "Anthropic",
      },
    ]);
    expect(fetcher).toHaveBeenCalledWith(
      "https://anthropic.example/v1/models",
      expect.objectContaining({
        headers: {
          Accept: "application/json",
          "anthropic-version": "2023-06-01",
          "x-api-key": "anthropic-secret",
        },
      }),
    );
    delete process.env.ANTHROPIC_KEY;
  });
});
