---
summary: Defines the architecture and configuration for multiple model providers, dynamic routing, and fallback chains in the Agent Harness.
read_when:
  - When implementing or reviewing the Multi-Provider Registry subsystem
  - When modifying LLM client initialization or settings configuration
---

# Multi-Provider Registry & Model Router Specification

Status: Implemented

## Problem and evidence

Agent Harness currently assumes a single global provider endpoint (`PROVIDER_ENDPOINT`) and a single API key environment variable (`API_KEY_ENV`), as defined in `packages/core/src/config.ts`. The model-to-protocol routing is hardcoded in `getModelProvider()` within `packages/core/src/llm/vercel-ai.ts` using a static `ANTHROPIC_MODELS` set. There is currently no mechanism to configure multiple providers, route specific models to designated providers, or implement fallback chains in the event of API failures.

## Goals and non-goals

### Goals
- Allow configuration and persistence of multiple model providers.
- Route models to specific providers based on model ID or agent-specific configuration.
- Implement automatic fallback to secondary eligible providers upon receiving 429 or 5xx errors.
- Remove hardcoded protocol logic (e.g., `ANTHROPIC_MODELS`) by declaring protocols explicitly per provider.
- Aggregate model capabilities seamlessly in the UI via `GET /api/settings/models`.
- Maintain backward compatibility with existing single-endpoint configurations.
- Apply accepted settings to all subsequently executing work without leaving loaded sessions on stale clients.
- Enforce configured provider request/token minute budgets process-wide with bounded local admission.

### Non-goals
- Per-tool-call routing (a single execution run will use the same provider consistently).
- Cost tracking or billing integrations.
- Support for complex provider authentication flows like OAuth (only environment variable API keys will be supported).
- Token streaming architecture (to be addressed in a separate spec).

## Required behavior

### 1. Core Provider Configuration Schema
Introduce a strict Zod schema for provider configuration in core (`packages/core/src/config.ts`):

```typescript
import { z } from "zod";

export const ProviderProtocol = z.enum(["openai", "anthropic"]);
export type ProviderProtocol = z.infer<typeof ProviderProtocol>;

export const ProviderEntrySchema = z.object({
  id: z.string(),
  displayName: z.string(),
  protocol: ProviderProtocol,
  baseUrl: z.string().url(),
  apiKeyEnv: z.string(),
  supportedModels: z.array(z.string()).optional(), // Explicit list or wildcard support
  rateLimit: z.object({
    requestsPerMinute: z.number().optional(),
    tokensPerMinute: z.number().optional(),
  }).optional(),
  enabled: z.boolean().default(true),
  priority: z.number().default(0), // Lower number = higher priority
});
export type ProviderEntry = z.infer<typeof ProviderEntrySchema>;
```

### 2. Provider Registry
Create a `ProviderRegistry` class in `packages/core/src/provider-registry.ts`:
- Responsible for storing, loading, and querying `ProviderEntry` instances.
- Resolves models to providers using a method like `resolveProvider(modelId: string, preferredProviderId?: string, requiredCapabilities?: Partial<CapabilityMatrix>): ProviderEntry[]`.
- Support dynamic routing attributes: if multiple providers support the exact same `modelId` (e.g., Anthropic directly vs. AWS Bedrock vs. Azure), the registry SHOULD allow routing based on latency profiles, cost configurations, or priority fields.
- Returns an ordered array of eligible providers for fallback chaining.

### 3. Agent Configuration Overrides
Update agent configuration (frontmatter/schema) to support optional `model` and `provider` fields, enabling per-agent provider routing overrides.

### 4. Server Configuration and Settings API
- Update `packages/server/src/server-config.ts` and `packages/server/src/routes/settings.ts`.
- Server loads the `providers` array from `.harness/settings.json` alongside the existing legacy flat config.
- Modify `GET /api/settings/models` to iterate through all enabled providers in `ProviderRegistry`, fetch models from each, and return a deduplicated, aggregated list.
- Add CRUD endpoints for `ProviderEntry` management.
- Use protocol-specific authentication and response parsing for OpenAI and Anthropic model discovery.
- After an accepted settings write, abort active work and unload cached runtimes before the new configuration generation is used.

### 5. Fallback Mechanism
Modify the LLM client execution flow to handle fallbacks. If the primary provider returns a 429 or 5xx error:
- Catch the error.
- Evaluate the provider against a Circuit Breaker pattern. If a provider fails continuously, it MUST be temporarily marked as 'open' (unavailable) to prevent cascading failures.
- Implement an Exponential Backoff strategy before immediately hitting the secondary provider.
- Retrieve the next eligible provider from the `ProviderRegistry`.
- Re-initialize the client and retry.
- Log failures with structured logging, ensuring telemetry tools can alert on provider degradation.
- Share circuit state across loaded sessions. Before each attempt, atomically reserve the configured request and conservative token estimate, including serialized tool definitions and parameter schemas; a denied reservation behaves as a local 429 and may fall back without waiting.

### 6. Capability Registry Integration
Update `CapabilityRegistry` calls to use the dynamically resolved provider ID rather than assuming a single provider context.

### 7. Backward Compatibility
If no `providers` array is defined in `.harness/settings.json`, automatically construct a synthetic `ProviderEntry` using the legacy `PROVIDER_ENDPOINT`, `API_KEY_ENV`, and hardcoded logic to ensure existing setups do not break.

## Acceptance criteria

1. **Multi-provider persistence:** Multiple providers can be configured, saved, and loaded from `.harness/settings.json`.
2. **Dynamic model routing:** `ProviderRegistry.resolveProvider` returns the correct primary and secondary providers based on `modelId` and agent overrides, ignoring disabled providers.
3. **Fallback handling:** Simulating a 429 or 5xx response from a primary provider results in an automatic retry using the secondary provider, accompanied by an explicit structured log entry.
4. **Backward compatibility:** Starting the server with a legacy configuration (no `providers` array) falls back to the legacy single-endpoint behavior without errors.
5. **Settings UI integration:** The settings UI can perform CRUD operations on providers and successfully test connectivity to each endpoint.
6. **Agent routing overrides:** Defining `model: "custom-model"` and/or `provider: "custom-id"` in an agent's frontmatter overrides the default global model and provider selection.
7. **Model aggregation:** `GET /api/settings/models` successfully fetches and deduplicates models from all enabled providers.
8. **Protocol-realistic discovery:** OpenAI uses bearer authentication and OpenAI list envelopes; Anthropic uses `x-api-key` plus `anthropic-version` and Anthropic model metadata. Both normalize to the public response.
9. **Live reconfiguration:** A successful settings write aborts active parent/worker work, waits for worker terminal cleanup after cancellation, unloads loaded runtimes, and resets provider runtime state before another delivery.
10. **Enforced limits:** Configured RPM/TPM limits are enforced across session clients without an unbounded wait queue, and token admission accounts for serialized tool parameter schemas.

## Deferred presentation question

- **UI UX for fallbacks:** surfacing the provider ultimately used for an individual turn remains future presentation work.

## Implemented decisions

- `supportedModels` accepts exact IDs and `*` wildcards; other regular-expression metacharacters remain literal.
- A transient 429/5xx opens a process-local circuit for one minute. Fallback attempts use bounded exponential backoff. Abort and non-transient failures propagate immediately without replay.
- Provider IDs are unique, bounded identifiers. The settings editor performs persisted list CRUD and exposes a credential-safe connectivity test; fallback-provider display in individual turns remains future presentation work.
- Provider runtime state, circuit health, and rate admission are server-owned as recorded in [ADR 0006](../../docs/decisions/0006-server-owned-provider-runtime.md). Settings replacement cancels and unloads the prior generation.
