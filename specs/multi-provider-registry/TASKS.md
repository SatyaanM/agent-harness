---
summary: Implementation tasks for Multi-Provider Registry
read_when:
  - Checking progress on Multi-Provider Registry tasks.
---

# Multi-Provider Registry Tasks

- [x] Define `ProviderEntry` and `ProviderProtocol` schemas in `packages/core/src/config.ts`.
- [x] Create `packages/core/src/provider-registry.ts` with `ProviderRegistry`.
- [x] Implement `resolveProvider()` priority, model-pattern, and agent-preference routing.
- [x] Integrate `ProviderRegistry` into `LLMClient` in `packages/core/src/llm/vercel-ai.ts`.
- [x] Implement Circuit Breaker and Exponential Backoff for 429/5xx errors.
- [x] Update `GET /api/settings/models` in `packages/server/src/routes/settings.ts` to aggregate multiple providers.
- [x] Add settings CRUD UI and per-provider connectivity testing.
- [x] Write tests for preferred routing, transient fallback, non-transient failures, cancellation, schemas, settings UI, and connectivity.
