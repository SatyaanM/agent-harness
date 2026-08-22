---
summary: Implementation tasks for Conversation Compaction
read_when:
  - Checking progress on Conversation Compaction tasks.
---

# Conversation Compaction Tasks

- [ ] Create SQLite migration `003_compaction_records.sql` for the tracking table.
- [ ] Implement `Compactor` class in `packages/core/src/agent/compactor.ts`.
- [ ] Add semantic memory extraction prompts to the compaction logic.
- [ ] Update `MessageRepository` to retrieve context dynamically swapped with summary blocks.
- [ ] Add context threshold calculation logic to `SessionRuntime.deliver()`.
- [ ] Trigger `Compactor` safely before LLM execution when threshold is exceeded.
- [ ] Add token cost tracking for compaction tasks to the run metadata.
- [ ] Write integration tests verifying idempotent tracking and context replacement.
