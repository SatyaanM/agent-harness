---
summary: Defines the Conversation Compaction feature to manage LLM context windows by summarizing historical messages while preserving full transcript fidelity.
read_when:
  - When implementing or reviewing this subsystem
  - When modifying context loading in SessionRuntime
  - When designing UI for displaying compacted message history
---
# Conversation Compaction Specification
Status: Implemented

## Problem and evidence

Agent Harness currently passes the entire historical transcript to the LLM on every step of every run. As sessions accumulate turns, this history grows without bound and eventually exceeds context windows, degrades response quality, and increases cost. There is currently no compaction, summarization, sliding window, or context management of any kind. The only token-related controls are `boundToolResult` (truncates individual tool outputs > 100K chars) and `maxTotalTokens` budget per run.

Verified current behavior:
- `packages/core/src/agent/session-runtime.ts`: `SessionRuntime.deliver()` / `runOnce()` loads full `session.messages` history and passes `[...baseHistory, ...deliveredSystem]` to `Agent.run()`.
- `packages/core/src/agent/agent.ts`: `Agent.runWithSignal()` assigns `this.messages = [...history, userPrompt]`, and all messages are passed to `llmClient.chat()` on every step.

## Goals and non-goals

### Goals
- Automatically compact (summarize) old messages when a session's token estimate exceeds a configured threshold (e.g., 80% of the model context window).
- Preserve the exact transcript of all original messages in the database (verbatim transcript invariant).
- Replace older messages with a summary message in the active LLM context without compounding previously compacted ranges.
- Allow agents to opt-out of compaction via configuration.
- Track token usage for compaction separately from primary task generation.
- Support UI visualization of compacted ranges as expandable blocks that can demand-load original messages.

### Non-goals
- Deleting or modifying original messages.
- Real-time streaming of compaction summaries.
- Cross-session compaction or shared summaries.
- Automatic compaction model selection based on cost optimization.

## Required behavior

### 1. Context Budget and Trigger
- **Threshold**: Compaction is triggered in `SessionRuntime` before making the next LLM call if the estimated token count of the active transcript exceeds the context threshold (default: 80% of the model's configured context window).
- **Opt-out**: Agents can disable compaction by setting `compaction: false` in their configuration/frontmatter. If disabled, compaction is bypassed even if the threshold is exceeded.

### 2. Compactor Subsystem
- Introduce a `Compactor` class in `packages/core/src/agent/compactor.ts`.
- The compactor identifies the oldest uncompacted $N$ messages (excluding the system prompt and the most recent $K$ turns) to summarize.
- Candidate boundaries are tool-exchange atomic: an assistant tool-call message and every contiguous matching tool result are either retained or compacted together. A candidate never starts with an orphan tool result or ends with unresolved tool calls.
- It uses the configured LLM client to generate a summary of the selected messages. The default model is the agent's main model, but it can be overridden.
- The provider request receives a projection with a 256,000-character absolute ceiling. Its effective ceiling is lower for small models: it is derived from the true context window after reserving conservative instruction and summary-output budgets. Individual content, reasoning, and serialized tool-call fields have 32,000-character ceilings with explicit truncation markers; canonical transcript rows are never changed.
- Summary generation has a 2,048-token absolute ceiling and is further capped by the provider's discovered maximum output and a conservative share of the true context window. It is accepted only when the provider reports `finishReason: stop`, returns non-empty text no longer than 32,000 characters, and returns no tool calls. Empty, length-truncated, filtered, errored, or tool-calling responses fail the run without creating a summary message or compaction record.
- **Semantic Memory Extraction**: During summarization, the Compactor MUST extract key entities, persistent facts, user preferences, and unresolved goals into a distinct structured memory block or key-value format, ensuring critical discrete state survives multiple rolling compactions.
- The summary becomes a system message inserted at the compaction boundary in the active context.

### 3. State Management and Idempotency
- **Schema**: Add a `compaction_records` table to SQLite via migration `003_compaction_records.sql`.
  ```sql
  CREATE TABLE IF NOT EXISTS compaction_records (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    summary_message_id TEXT NOT NULL REFERENCES messages(id),
    start_sequence INTEGER NOT NULL,
    end_sequence INTEGER NOT NULL,
    original_token_estimate INTEGER NOT NULL,
    summary_token_estimate INTEGER NOT NULL,
    compacted_at INTEGER NOT NULL,
    model_used TEXT NOT NULL,
    CONSTRAINT uq_session_range UNIQUE (session_id, start_sequence, end_sequence),
    CONSTRAINT chk_range_valid CHECK (end_sequence > start_sequence)
  );
  ```
- **Idempotency**: The system must never re-compact a summary message. The `compaction_records` track ranges to ensure only uncompacted original messages are selected.

### 4. Database Access
- Update `packages/core/src/persistence/sqlite/message-repo.ts` (`MessageRepository`).
- Add a method to fetch the active context for a session, which returns a mix of summary messages and recent uncompacted messages, substituting the original ranges described by `compaction_records` with their corresponding `summary_message_id`.
- The original messages must remain queryable via existing listing methods (e.g., for dashboard expansion).

### 5. Telemetry and Tracking
- Compaction operations cost tokens. This usage must be captured.
- Expand run metadata to track `compactionTokenUsage` independently of the main run execution.

## Acceptance criteria

1. **Triggering**: A session whose active token estimate exceeds the configured threshold successfully triggers the `Compactor` before the next LLM API call.
2. **Preservation**: Original messages compacted into a summary are preserved intact in the SQLite database and can be fetched via API.
3. **Context Construction**: The generated summary is faithfully inserted as a system message in the LLM context, replacing the specified range of original messages.
4. **Idempotency**: Already compacted ranges are never re-selected for compaction; summaries are never summarized again.
5. **Opt-out**: An agent configured with `compaction: false` never triggers the compactor, even if its context exceeds the threshold.
6. **UI Compatibility**: The UI data payload includes metadata indicating compacted ranges, allowing the dashboard to render expandable blocks and fetch original messages.
7. **Cost Tracking**: Tokens used for summarization are correctly recorded under a separate compaction usage metric in the run's metadata.
8. **Performance**: The compaction summarization step blocks for at most the duration of a single LLM API call (< 5s on average).
9. **Migration**: The `003_compaction_records.sql` migration runs successfully on startup and creates the required schema.
10. **Budget semantics**: `capabilities.contextWindowTokens` controls the compaction threshold; `capabilities.maxTokens` remains the provider's maximum output-token capability and `maxOutputTokens` remains the primary run output request limit. Missing/zero context-window discovery uses the 128,000-token fallback.
11. **Atomic boundaries**: Compaction never separates an assistant tool call from its corresponding contiguous tool results.
12. **Bounded summarization**: Compaction input projection and summary output are explicitly bounded, and unusable provider responses leave durable state unchanged.
13. **Rollback integrity**: Rolling migration 003 back to 002 removes only messages referenced as derived compaction summaries, preserves every canonical transcript message, then removes the compaction table. Reapplying 003 succeeds.

## Open questions and decisions
- **Summary detail level**: The prompt requires a distinct structured semantic-memory block followed by a chronological summary, explicitly preserving paths, subagent IDs, configuration choices, preferences, facts, entities, and unresolved goals.
- **Variable chunking ($N$ and $K$)**: Defaults are 50 messages per oldest contiguous chunk and 8 recent active messages retained verbatim. Agents may override both in frontmatter with bounded integer settings.
- **Separate token budgets**: `capabilities.contextWindowTokens` is the discovered/manual input context capacity. `capabilities.maxTokens` continues to mean discovered maximum output capacity, and `maxOutputTokens` is the requested primary generation cap. The runtime uses a 128,000-token context fallback and an 80% trigger ratio when no positive context capacity is known.
- **Bounded projection tradeoff**: Oversized fields are represented by a deterministic prefix plus a truncation marker in the compactor-only projection. Absolute caps are ceilings; the runtime lowers them to fit small discovered context/output limits after reserves. This bounds provider input without mutating or rewriting canonical message bytes.
