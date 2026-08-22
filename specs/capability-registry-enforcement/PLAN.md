---
summary: Implementation plan for Capability Registry Enforcement
read_when:
  - Executing implementation tasks for Capability Registry Enforcement.
---

# Capability Registry Enforcement Implementation Plan

Status: Draft

## Inputs
- Governing Specification: `specs/capability-registry-enforcement/SPEC.md`
- Current Codebase: `packages/core/src/agent/agent.ts`, `packages/core/src/agent/types.ts`

## Sequence

### Phase 1: Capability Overrides
- **Objective**: Allow frontmatter to override tier 2-4 lookups.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/types.ts` (`AgentConfig`)
- **Behavior**: Agents can explicitly define capability bounds.
- **Verification**: Type checks on modified schemas.

### Phase 2: Runtime Enforcement and Stripping
- **Objective**: Strip unallowed tools and vision payloads from the prompt.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/agent.ts` (`Agent.run`)
- **Behavior**: Queries `this._capabilityRegistry.lookup()`. Strips tools if `tools: false`. Strips images if `vision: false`. Enforces HITL boundary if the model lacks reasoning bounds.
- **Verification**: Unit tests ensuring missing capability prevents tool inclusion.

### Phase 3: Advanced Capabilities Integration
- **Objective**: Support structured outputs and prompt caching.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/agent.ts`
- **Behavior**: Uses native JSON schema support if `structuredOutputs: true`. Applies caching breakpoints if `promptCaching: true`.
- **Verification**: Assert correct provider API parameters are mapped.
