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
