---
summary: Implementation tasks for Capability Registry Enforcement
read_when:
  - Checking progress on Capability Registry Enforcement tasks.
---

# Capability Registry Enforcement Tasks

- [x] Update `AgentConfig` schema in `packages/core/src/agent/types.ts` to accept `capabilities` frontmatter.
- [x] Inject `capabilityRegistry.lookup()` into the `Agent.run()` method.
- [x] Implement payload stripping for `tools` (and HITL tool constraints) based on resolved matrix.
- [x] Implement payload stripping for `vision` parts from message history.
- [x] Implement `structuredOutputs` mapping to native provider APIs.
- [x] Implement `promptCaching` breakpoints injection.
- [x] Add unit tests verifying tools and images are stripped when corresponding capability is false.
- [x] Resolve capability provider/model identity through `ProviderRegistry` without splitting slash-containing IDs.
- [x] Probe configured OpenAI and Anthropic targets with environment-owned credentials and conservative failure.
- [x] Use one eligible map for both advertised and executable tools, including worker/config/HITL denials.
- [x] Apply AI SDK 7 Anthropic prompt-cache provider options and a system-message breakpoint.
- [x] Expose pre-resolution so earlier runtime stages and `Agent.run()` can share one matrix.
- [x] Intersect capabilities across every eligible fallback target, using minimum-positive numeric bounds and zero only for all-unknown targets.
- [x] Admit every live probe request and transient retry through shared provider RPM/TPM state, with numeric-only circuit mutation.
- [x] Cache recovered success and stable feature denials while excluding exhausted-transient, rejected, and admission-denied probe matrices.
- [x] Key durable configured-provider capabilities by non-secret provider configuration identity.
