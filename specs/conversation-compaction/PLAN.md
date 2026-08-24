---
summary: Implementation plan for Conversation Compaction
read_when:
  - Executing implementation tasks for Conversation Compaction.
---

# Conversation Compaction Implementation Plan

Status: Implemented

## Inputs
- Governing Specification: `specs/conversation-compaction/SPEC.md`
- Current Codebase: `packages/core/src/persistence/sqlite/message-repo.ts`, `packages/core/src/agent/session-runtime.ts`

## Sequence

### Phase 1: Database Migration
- **Objective**: Track idempotent compaction ranges.
- **Files/Symbols**:
  - [NEW] `packages/core/src/persistence/sqlite/migrations/003_compaction_records.sql`
- **Behavior**: Introduces `compaction_records`; rollback first deletes only summary messages referenced by those records, then removes derived schema.
- **Verification**: Migrator up -> down-to-v2 -> up proves canonical messages survive, derived summaries are removed, and embedded/file SQL remain synchronized.

### Phase 2: Compactor Engine
- **Objective**: Build the LLM summarization and extraction subsystem.
- **Files/Symbols**:
  - [NEW] `packages/core/src/agent/compactor.ts`
- **Behavior**: Identifies oldest tool-exchange-safe groups, generates a block summary under a 256,000-character absolute projection ceiling, and extracts semantic memory under 2,048-token/32,000-character absolute output ceilings. Effective limits are reduced to fit the discovered context/output budgets after conservative reserves.
- **Verification**: Unit tests cover atomic tool boundaries, deterministic projection truncation (including an oversized tool result on a small-context model), effective output-token propagation, and rejection of empty, truncated, filtered, errored, or tool-calling responses.

### Phase 3: Runtime Integration
- **Objective**: Trigger compaction safely before runs.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/persistence/sqlite/message-repo.ts`
  - [MODIFY] `packages/core/src/agent/session-runtime.ts`
- **Behavior**: `capabilities.contextWindowTokens` (never output limits) drives threshold -> safe compaction -> atomic summary/range persistence -> active-context substitution.
- **Verification**: Runtime tests distinguish context/output budgets and prove rejected summaries do not persist any derived state.
