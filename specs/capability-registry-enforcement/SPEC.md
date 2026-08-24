---
summary: Defines the enforcement of the 4-tier capability registry lookup in Agent.run() to properly scope LLM requests based on model capabilities.
read_when:
  - When implementing capability-aware request modification in the agent execution loop
  - When debugging missing tools or stripped vision parts in LLM payloads
---
Status: Implemented

## Problem and evidence

The repository originally had a four-tier capability lookup library that was not connected to execution. The live implementation now must keep provider routing, discovery, advertised tools, and executable tools on the same bounded target; otherwise a model can invoke a registered but unconfigured or capability-ineligible tool.

Configured model IDs are opaque and may contain `/`, prompt caching must use the installed AI SDK 7 contract, and configured-provider probes must use the provider's declared protocol and environment-owned credential without surfacing it.

## Goals and non-goals

### Goals
- Ensure `Agent.run()` utilizes `capabilityRegistry.lookup()` to determine a model's capabilities before sending requests to the LLM.
- Prevent sending unsupported tool definitions and image content parts to models that lack `tools` or `vision` capabilities, respectively.
- Provide a mechanism for users to manually override capabilities via agent frontmatter (Tier 1 lookup).
- Emit diagnostics when there is a mismatch between declared capabilities and model behavior (e.g., unexpected tool calls).
- Preserve standalone `Agent` use while allowing a runtime owner to pre-resolve and reuse the same matrix for earlier context decisions.
- Fail conservatively when a configured live provider probe cannot establish support.
- Resolve one fallback-safe matrix by intersecting every eligible provider target.
- Make live probes consume the server-owned circuit and per-request RPM/TPM state.
- Prevent durable capabilities from crossing provider endpoint/protocol configuration generations.
- Ensure the lookup adds minimal overhead (< 5ms) to run startup by caching results per-run.

### Non-goals
- Changing capabilities dynamically per-tool-call during a single run.
- Providing a UI for browsing or editing capability matrices.
- Implementing plugin-contributed tool capability declarations at this stage.

## Required behavior

### 1. Capability Resolution and Caching
When `Agent.run()` starts without a supplied matrix, it MUST resolve through `CapabilityRegistry.lookupModel(model, preferredProvider, sdk, agentConfig)`. The provider registry owns provider/model separation; configured model IDs are never split on `/`.
The result MUST be cached for the duration of the run to avoid repeated lookups during multi-step executions.
`Agent.resolveCapabilities()` exposes the same resolution seam to runtime owners, and `Agent.run(..., resolvedCapabilities)` MUST not repeat it. If a configured live probe fails, the matrix MUST conservatively disable unverified features.

For a configured fallback chain, lookup MUST resolve every eligible target and intersect the results. Boolean fields use logical AND. Numeric output and context limits use the minimum, with zero remaining conservative when any target has an unknown limit. Durable entries are keyed by provider/model/SDK plus a non-secret provider configuration identity containing protocol, normalized base URL, and credential environment-variable name; identity-less entries do not satisfy configured lookups.

Configured live probes MUST use the same server-owned `ProviderRuntimeState` as execution. Every actual probe request, including optional probes and retries, performs circuit and RPM/TPM admission immediately before network I/O. Successful HTTP responses close the provider circuit; numeric 429/5xx responses open it; aborts and other 4xx responses do not. Admission-denied partial results are conservative but are not persisted after the window/circuit changes.

### 2. Payload Modification based on CapabilityMatrix
Before invoking `llmClient.chat()` (or its streaming equivalent), the agent MUST inspect the resolved `CapabilityMatrix` and modify the request payload as follows:
- **Tools**: Build one eligible map from configured tools, matrix support, and HITL/reasoning bounds. Use that exact map both for provider definitions and execution. Calls outside it—including worker `delegate`, config-excluded, unknown, and HITL-ineligible tools—MUST be sanitized, diagnosed, denied, and never executed.
- **Vision**: If `matrix.vision === false`, the agent MUST strip all image content parts from the message history before sending them to the LLM.
- **Max Tokens**: If `matrix.maxTokens` is defined, the agent MUST use this value to set the `max_tokens` (or `max_output_tokens`, depending on the provider) on the LLM request, UNLESS a lower explicit limit is set in the agent's specific configuration.
- **Streaming**: If `matrix.streaming === true` and streaming is requested by the invocation, the agent MUST use the streaming path (integrating with the broader streaming implementation).
- **Structured Outputs**: If `matrix.structuredOutputs === true`, the agent MUST use the provider's native JSON schema adherence features. Otherwise, it must inject schema instructions directly into the system prompt.
- **Prompt Caching**: For Anthropic targets with `matrix.promptCaching === true`, the adapter MUST use stable AI SDK 7 `providerOptions` and an explicit system-message `cacheControl` breakpoint. Experimental/removed metadata options are prohibited.

### 3. Agent Frontmatter Overrides
The `AgentConfig` (and its schema in `packages/core/src/agent/types.ts`) MUST support an optional `capabilities` field:
```typescript
interface AgentConfig {
  // existing fields...
  capabilities?: Partial<CapabilityMatrix>;
}
```
This configuration serves as the Tier 1 override in the capability lookup process. When specified, these values take precedence over all other tiers.

### 4. Worker Scope and Delegation
When an agent spawns a worker (in `packages/core/src/agent/delegation.ts`), the worker MUST inherit a scoped capability set from its parent. Specifically, the `delegate` capability MUST be explicitly excluded or disabled for the worker, regardless of the underlying model's capabilities, reinforcing the wake-run guard at the capability layer.

### 5. Diagnostics
The agent MUST monitor the LLM's responses for capability mismatches. If the model returns a tool call request (e.g., a function call) when the resolved capability matrix states `tools: false`, the agent MUST emit a `capability-mismatch` diagnostic event.

## Acceptance criteria

1. **Tool Stripping**: An agent configured with a model that resolves to `tools: false` does not include tool definitions in its payload to `llmClient.chat()`.
2. **Vision Stripping**: An agent configured with a model that resolves to `vision: false` successfully sends messages by stripping any image content parts from the prompt, preventing API rejection.
3. **Frontmatter Override**: An agent defining `capabilities: { tools: false }` in its frontmatter overrides the registry lookup and results in no tools being sent, even if the model inherently supports them.
4. **Diagnostic Emission**: A `capability-mismatch` diagnostic is logged/emitted when a model unexpectedly returns a tool call despite the capability matrix declaring `tools: false`.
5. **Worker Delegation Restriction**: Workers initialized via delegation cannot utilize the `delegate` tool, enforced at the capability scope level.
6. **Per-Run Caching**: The capability registry lookup is performed exactly once per `Agent.run()` execution and cached for all subsequent steps in that run.
7. **Backward Compatibility**: Existing agents with no `capabilities` field in their frontmatter operate identically to their current behavior (utilizing Tier 2-4 lookups or the permissive default if lookups fail).
8. **Bounded lookup:** Cached resolution is local and one-per-run. A cache miss may perform bounded external discovery/probing and is not represented as a sub-5ms operation.
9. **Execution-map parity:** A tool omitted from provider definitions cannot execute even if the provider hallucinates its name and it exists in the global registry.
10. **Provider-aware probing:** OpenAI and Anthropic probes use their declared endpoint, authentication, and request envelopes without logging or returning credentials; failure is conservative.
11. **Reusable matrix:** A pre-resolved matrix skips the standalone lookup so earlier runtime stages and `Agent` share one decision.
12. **Fallback-safe intersection:** Heterogeneous eligible targets produce boolean AND and conservative minimum/zero numeric limits before request shaping.
13. **Shared probe policy:** Every provider probe request consumes the shared configured admission budget and updates the shared circuit only for success or numeric transient HTTP outcomes.
14. **Configuration-bound cache:** Changing a configured provider endpoint or protocol cannot reuse a durable capability entry from the prior configuration identity.

## Decisions

- **Diagnostic handling**: A disabled tool call is removed from the assistant message, emitted as a warning and `capability-mismatch` event, and followed by a system denial asking the model for a text-only response. It is never executed.
- **Vision stripping detail**: Stripped image markdown is replaced with `[Image omitted due to model capability]` so surrounding text retains context.
- **Provider correlation**: provider/model targets come from `ProviderRegistry.resolveTargets()`; `/` is valid model identity, not an implicit provider delimiter.
- **Fallback correlation**: the reusable run matrix is the conservative intersection across every eligible target, not only the preferred provider.
- **Probe ownership**: capability probes and execution share one server-owned provider generation for circuit and rate admission.
- **Cache identity**: configured-provider cache keys include non-secret protocol, endpoint, and credential-source identity; derived identity-less entries remain readable but do not match configured lookups.
