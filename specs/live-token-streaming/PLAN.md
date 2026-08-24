---
summary: Implementation plan for Live Token Streaming
read_when:
  - Executing implementation tasks for Live Token Streaming.
---

# Live Token Streaming Implementation Plan

Status: Implemented

## Inputs
- Governing Specification: `specs/live-token-streaming/SPEC.md`
- Current Codebase: `packages/core/src/llm/client.ts`, `packages/core/src/llm/vercel-ai.ts`, `packages/core/src/agent/agent.ts`, `packages/server/src/routes/chat.ts`

## Sequence

### Phase 1: Client Streaming Interface
- **Objective**: Extend LLM client for token streams.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/llm/client.ts` (`LLMStreamDelta`, `chatStream`)
  - [MODIFY] `packages/core/src/llm/vercel-ai.ts` (Implement `chatStream`)
- **Behavior**: Yields `text-delta` and `tool-call-delta` pieces.
- **Verification**: Tests validating stream parser yields valid objects.

### Phase 2: Agent Runtime & Telemetry
- **Objective**: Refactor run loop to consume streams.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/agent.ts`
- **Behavior**: Accumulates tool pieces (executes only when complete), pipes text to transport, and calculates TTFT/TPS metrics.
- **Verification**: Validate final transcript fidelity and metrics calculation.

### Phase 3: Server & UI Transport
- **Objective**: Plumb stream directly to HTTP SSE endpoint.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/session-runtime.ts`
  - [MODIFY] `packages/server/src/routes/chat.ts`
- **Behavior**: Server sends real tokens over SSE, including partial tool calls for dashboard rendering.
- **Verification**: E2E test verifying SSE format.
