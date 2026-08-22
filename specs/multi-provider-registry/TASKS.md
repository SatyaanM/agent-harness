---
summary: Implementation tasks for Multi-Provider Registry
read_when:
  - Checking progress on Multi-Provider Registry tasks.
---

# Multi-Provider Registry Tasks

- [ ] Define `ProviderEntry` and `ProviderProtocol` schemas in `packages/core/src/config.ts`.
- [ ] Create `packages/core/src/provider-registry.ts` with `ProviderRegistry`.
- [ ] Implement `resolveProvider()` logic with dynamic routing attributes (cost, latency).
- [ ] Integrate `ProviderRegistry` into `LLMClient` in `packages/core/src/llm/vercel-ai.ts`.
- [ ] Implement Circuit Breaker and Exponential Backoff for 429/5xx errors.
- [ ] Update `GET /api/settings/models` in `packages/server/src/routes/settings.ts` to aggregate multiple providers.
- [ ] Write unit tests simulating provider failure and fallback logic.
