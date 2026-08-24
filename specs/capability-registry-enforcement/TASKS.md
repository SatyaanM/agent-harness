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
- [x] Intersect capabilities across every eligible fallback target, including conservative numeric minimum/zero handling.
- [x] Admit every live probe request through the shared provider RPM/TPM and circuit state.
- [x] Key durable configured-provider capabilities by non-secret provider configuration identity.
