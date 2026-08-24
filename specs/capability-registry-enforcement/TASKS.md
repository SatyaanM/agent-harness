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
