## Conversation Compaction (PR 4)

This PR implements the Conversation Compaction subsystem to automatically manage LLM context windows by summarizing historical messages while preserving full transcript fidelity.

### Features
* Introduced `Compactor` subsystem to summarize chunks of conversation history.
* Added `003_compaction_records.sql` migration for idempotent SQLite compaction tracking.
* Updated `MessageRepository.getActiveContext` to replace compacted ranges with their summary messages dynamically.
* Integrated compaction triggers in `SessionRuntime.deliver()` based on model context thresholds (80%).
* Added cost tracking for compaction ops in `RunRow.tokenUsage`.
* Provided ability to opt-out via `compaction: false` in Agent configuration.
