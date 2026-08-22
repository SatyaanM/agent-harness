---
summary: Implementation tasks for Capability Registry Enforcement
read_when:
  - Checking progress on Capability Registry Enforcement tasks.
---

# Capability Registry Enforcement Tasks

- [ ] Update `AgentConfig` schema in `packages/core/src/agent/types.ts` to accept `capabilities` frontmatter.
- [ ] Inject `capabilityRegistry.lookup()` into the `Agent.run()` method.
- [ ] Implement payload stripping for `tools` (and HITL tool constraints) based on resolved matrix.
- [ ] Implement payload stripping for `vision` parts from message history.
- [ ] Implement `structuredOutputs` mapping to native provider APIs.
- [ ] Implement `promptCaching` breakpoints injection.
- [ ] Add unit tests verifying tools and images are stripped when corresponding capability is false.
