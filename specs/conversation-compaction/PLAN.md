---
summary: Implementation plan for Conversation Compaction
read_when:
  - Executing implementation tasks for Conversation Compaction.
---

# Conversation Compaction Implementation Plan

Status: Draft

## Inputs
- Governing Specification: `specs/conversation-compaction/SPEC.md`
- Current Codebase: `packages/core/src/persistence/sqlite/message-repo.ts`, `packages/core/src/agent/session-runtime.ts`

## Sequence

### Phase 1: Database Migration
- **Objective**: Track idempotent compaction ranges.
- **Files/Symbols**:
  - [NEW] `packages/core/src/persistence/sqlite/migrations/003_compaction_records.sql`
- **Behavior**: Introduces `compaction_records` table schema.
- **Verification**: Migrator test suite runs successfully.

### Phase 2: Compactor Engine
- **Objective**: Build the LLM summarization and extraction subsystem.
- **Files/Symbols**:
  - [NEW] `packages/core/src/agent/compactor.ts`
- **Behavior**: Identifies oldest `N` messages, generates block summary, and extracts semantic memory.
- **Verification**: Unit tests on mock history ensuring correct boundaries.

### Phase 3: Runtime Integration
- **Objective**: Trigger compaction safely before runs.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/persistence/sqlite/message-repo.ts`
  - [MODIFY] `packages/core/src/agent/session-runtime.ts`
- **Behavior**: Context window estimates threshold -> triggers compaction -> substitutes context range with summary.
- **Verification**: E2E test verifying context truncation during long sessions.
