---
summary: Implementation plan for Multi-Provider Registry
read_when:
  - Executing implementation tasks for Multi-Provider Registry.
---

# Multi-Provider Registry Implementation Plan

Status: Draft

## Inputs
- Governing Specification: `specs/multi-provider-registry/SPEC.md`
- Current Codebase: `packages/core/src/llm/vercel-ai.ts`, `packages/core/src/config.ts`

## Sequence

### Phase 1: Core Configuration and Registry
- **Objective**: Add schemas and `ProviderRegistry` class.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/config.ts` (`ProviderProtocol`, `ProviderEntrySchema`)
  - [NEW] `packages/core/src/provider-registry.ts` (`ProviderRegistry` singleton)
- **Behavior**: Enables registering multiple providers with cost/latency metadata and capability routing.
- **Verification**: Unit tests for registry loading and priority sorting.

### Phase 2: Client Fallback & Circuit Breaking
- **Objective**: Integrate registry into LLM client for exponential backoff.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/llm/vercel-ai.ts`
- **Behavior**: On 429/5xx, client marks provider as 'open' (unavailable) and retries next eligible provider using exponential backoff.
- **Verification**: Simulate 429 and verify the secondary provider is called.

### Phase 3: Server Aggregation
- **Objective**: Update dashboard settings API.
- **Files/Symbols**:
  - [MODIFY] `packages/server/src/routes/settings.ts`
- **Behavior**: Returns a deduplicated list of available models across all enabled providers.
- **Verification**: Ensure `GET /api/settings/models` aggregates successfully without duplicating models.
