---
summary: Implementation plan for Capability Registry Enforcement
read_when:
  - Executing implementation tasks for Capability Registry Enforcement.
---

# Capability Registry Enforcement Implementation Plan

Status: Implemented

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

### Phase 4: Provider parity and reusable resolution
- **Objective**: Keep routing, probing, advertised tools, and executable tools on one target/matrix.
- **Files/Symbols**: `CapabilityRegistry.lookupModel`, `Agent.resolveCapabilities`, `Agent.run`, `createVercelAILLMClient`.
- **Behavior**: Preserve slash-containing IDs; probe declared OpenAI/Anthropic protocols; accept a pre-resolved matrix; deny every call outside the eligible map; use supported prompt-cache options.
- **Verification**: Adapter assertions, provider-aware probe tests, pre-resolved lookup-count test, and hallucinated delegate/config/HITL denial tests.

### Phase 5: Fallback-safe capability ownership
- **Objective**: Keep one capability decision safe across every runtime fallback and provider generation.
- **Files/Symbols**: `CapabilityRegistry.lookupModel`, `probeCapabilities`, `CapabilityCache`, `ProviderRuntimeState`.
- **Behavior**: Intersect every eligible target, admit each probe request through shared runtime policy, update shared circuits from HTTP outcomes, and bind durable entries to non-secret provider configuration identity.
- **Verification**: Heterogeneous-provider intersection, numeric minimum/zero, request-admission/circuit, and endpoint/protocol cache invalidation tests.
