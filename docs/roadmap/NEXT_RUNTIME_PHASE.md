---
summary: Ordered, testable design backlog for stabilizing runtime identity, lifecycle, persistence, and delivery.
read_when:
  - Starting the first post-bootstrap runtime architecture phase.
  - Choosing the next implementation task after repository bootstrap.
---

# Next runtime phase

## Outcome

Produce an approved, executable design for durable conversation/task/run identity and recovery without adding unrelated runtime features. The phase ends with migration fixtures, contract tests around current behavior, and a small implementation plan—not with a wholesale rewrite.

## Why this comes first

The current system has meaningful durability work in [`SessionStore`](../../packages/core/src/persistence/session.ts) and [`SessionRuntime`](../../packages/core/src/agent/session-runtime.ts), but uses one `SessionData` shape for conversations and worker executions while runs are implicit. Expanding skills, providers, councils, plugins, or autonomous operation first would multiply this ambiguity and make recovery harder.

## Ordered backlog

### 1. Capture current contracts with focused tests

Add deterministic tests before changing schemas or behavior:

- transcript writes are serialized and atomic for one session;
- mailbox appends preserve order and a drain removes exactly the delivered batch;
- a simulated crash between mailbox drain and transcript save exposes the current loss window and drives the target contract;
- a user delivery persists one user message and the expected complete assistant/tool transcript append;
- a mailbox-only wake materializes every completion and cannot use `delegate`;
- loaded and unloaded parent sessions take the documented completion paths;
- cancellation yields one terminal worker outcome;
- nested delegation is attributed to the correct parent task/session rather than the original root registry;
- session index rebuild excludes worker transcripts;
- opening a session with and without pending mail has different execution effects.

Exit evidence: red/green tests run without an API key using fake `LLMClient`, temporary directories, and injected event collectors. Test names state the durability invariant, not implementation details.

### 2. Write the identity and lifecycle specification

Using [the runtime ontology](../architecture/RUNTIME_ONTOLOGY.md), decide:

- IDs and relationships for agent definitions, conversations, tasks, runs, messages, worker transcripts, and delivery events;
- task/run/delivery state machines and legal transitions;
- retry, cancellation, interruption, abandonment, and duplicate-delivery behavior;
- when an agent-definition revision and model/provider configuration are pinned;
- user-visible behavior after process restart or reconnect.

Exit evidence: an accepted spec with examples for normal completion, two concurrent workers, cancellation, crash before completion, crash after mailbox append, crash during wake, and duplicate recovery.

### 3. Define persistence consistency and migration

Design storage only after the lifecycle is agreed:

- authoritative records versus rebuildable projections;
- atomicity boundaries and idempotency keys;
- single-process and possible multi-process assumptions;
- schema versions and forward/backward compatibility;
- import of existing top-level JSON, `worker-*` JSON, mailbox JSONL, index, and open-session state;
- corrupt/partial record quarantine and operator-visible diagnostics.

Exit evidence: versioned example fixtures for current and target records, a migration decision table, and tests that load old, mixed, missing, and corrupt fixtures without silent data loss.

### 4. Define runtime recovery and concurrency ownership

Specify the server startup and execution boundary:

- how persisted `running` work becomes `interrupted`, resumable, retryable, or abandoned;
- where concurrency limits are enforced and what they count;
- how cancel requests race with completion and restart;
- how one live runtime per conversation is guaranteed;
- when opening/history hydration wakes pending delivery;
- how sockets and UI projections resynchronize after missed events.

Exit evidence: a failure matrix with expected durable state and UI state for each interruption point, plus contract tests using controlled promises/fake clocks.

### 5. Reconcile public contracts and settings

Before implementation, align advertised behavior with the accepted design:

- mark provider routing, capability discovery, concurrency, streaming, councils, and plugin surfaces as implemented, partial, or planned;
- remove or hide settings that remain unenforced;
- define REST and WebSocket payload versioning for task/run/delivery state;
- decide whether the remaining process-local collaboration primitives and council UI types are retained, integrated later, or deprecated. The legacy polling `Orchestrator` has been removed.

Exit evidence: reviewed API/event tables and documentation changes with no intent-only capability described as current.

### 6. Plan one vertical implementation slice

Choose the smallest slice that improves recovery while preserving existing UX. A likely first candidate is first-class task/run identity plus restart reconciliation for interrupted workers, behind an adapter that can still read existing `SessionData`.

The implementation plan must include:

- exact files and symbols;
- migration and rollback sequence;
- tests added before each behavior change;
- compatibility behavior for existing sessions;
- instrumentation and user-visible failure states;
- explicit exclusions for providers, skills, plugin loading, councils, branching, and compaction.

Exit evidence: dependency-ordered tasks small enough for separate conventional commits and a clean `corepack npm run check` before implementation begins.

## Research questions, not implementation tasks

- Whether file-backed storage remains adequate after consistency requirements are explicit.
- Whether delivery needs acknowledgement beyond durable transcript materialization.
- Whether worker transcripts should remain first-class files or become projections over run records.
- Whether interrupted tool calls can ever be safely retried automatically.
- Whether per-conversation agent-definition pinning is necessary for reproducibility.

## Phase guardrails

- Do not introduce product runtime skills while `.agents/skills` terminology is fresh but unrelated.
- Do not select a database or framework by analogy to an upstream project.
- Do not merge provider, plugin, and persistence redesigns into one migration.
- Do not rely on a browser tab being open for durable work to reach a terminal recorded state.
- Do not claim crash safety until tests interrupt every durable boundary being claimed.

## Recommended first task

Create a `runtime-identity-and-recovery` specification plus a test harness for `SessionStore`, `SessionRuntime`, and `SessionManager`. That task should change tests and design artifacts only. Re-evaluate the implementation roadmap after those tests reveal the actual seams and failure modes.
