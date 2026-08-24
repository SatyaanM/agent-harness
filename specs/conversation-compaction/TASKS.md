---
summary: Implementation tasks for Conversation Compaction
read_when:
  - Checking progress on Conversation Compaction tasks.
---

# Conversation Compaction Tasks

- [x] Create SQLite migration `003_compaction_records.sql` for the tracking table.
- [x] Implement `Compactor` class in `packages/core/src/agent/compactor.ts`.
- [x] Add semantic memory extraction prompts to the compaction logic.
- [x] Update `MessageRepository` to retrieve context dynamically swapped with summary blocks.
- [x] Add context threshold calculation logic to `SessionRuntime.deliver()`.
- [x] Trigger `Compactor` safely before LLM execution when threshold is exceeded.
- [x] Add token cost tracking for compaction tasks to the run metadata.
- [x] Write integration tests verifying idempotent tracking and context replacement.
- [x] Specify distinct context-window, provider output-capability, and requested output-token semantics.
- [x] Add tool-call/result atomic candidate-boundary regressions and implementation.
- [x] Bound compaction-only input projection and summary output request/response.
- [x] Reject unusable compaction responses without durable writes.
- [x] Make v3 -> v2 rollback delete only referenced derived summaries and prove up/down/up integrity.
