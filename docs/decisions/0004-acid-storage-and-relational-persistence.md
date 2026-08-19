---
summary: Adopt embedded SQLite with WAL mode for ACID storage, relational entities, and atomic mailbox delivery.
read_when:
  - Designing persistence, mailbox delivery, session storage, or database migrations in @agent-harness/core.
  - Evaluating transaction boundaries across sessions, runs, tasks, and mailbox events.
---

# ADR 0004: Embedded SQLite with WAL mode for ACID persistence and delivery

Status: Proposed
Date: 2026-08-18

## Context

Currently, Agent Harness relies on loose files on disk for persistence:
- Session transcripts are serialized as whole JSON files (`<sessionId>.json`) via atomic rename.
- Worker completion mailboxes are serialized as line-delimited JSONL (`<sessionId>.mailbox.jsonl`).
- Metadata collections rely on a derived index file (`.index.json`).
- Active and open session tabs are stored in `.harness/open-sessions.json`.

While individual file renames are atomic within a single Node.js process, multi-resource operations (e.g., draining a worker mailbox into a session transcript snapshot, updating metadata index, and maintaining task statuses) cannot participate in a shared atomic transaction. In the event of a hard process termination, power loss, or filesystem lock contention:
1. Mailbox drain requires a "materialize-before-acknowledge" recovery protocol that leaves replayable entries on disk.
2. In-flight background workers lose in-memory lifecycle state and cannot be reconciled or marked as abandoned/failed on server reboot.
3. User session data and worker traces share the untyped `SessionData` structure differentiated only by `worker-` naming conventions.
4. Concurrency scaling is limited by directory scan bottlenecks and filesystem metadata overhead.

## Decision

1. **Adopt embedded SQLite (via `better-sqlite3` or `libsql`) with Write-Ahead Logging (WAL) mode** as the primary storage engine in `@agent-harness/core/persistence`.
2. **Normalize durable concepts into relational schemas**:
   - `sessions`: Top-level conversation metadata, agent configuration snapshot, timestamps.
   - `runs`: Ephemeral and durable execution attempts, run IDs, token metrics, model configurations.
   - `messages`: Individual conversational and tool interaction messages with explicit ordering sequence numbers.
   - `tasks`: Explicit background worker delegated tasks with status (`queued`, `running`, `completed`, `failed`, `cancelled`, `abandoned`).
   - `mailbox_events`: Durable worker completion deliveries targeted at parent sessions.
   - `open_sessions`: Server-owned open tab registry.
3. **Enforce ACID Transactions for Mailbox Drain**:
   Mailbox consumption executes inside an atomic `BEGIN IMMEDIATE` / `COMMIT` SQLite transaction:
   - Read pending `mailbox_events` for `parent_session_id`.
   - Insert system messages into `messages` table with monotonic sequence IDs.
   - Mark `mailbox_events` as `acknowledged` in the same transaction.
4. **Implement Versioned Migrations**:
   A dedicated `schema_migrations` table records applied SQL migration scripts. Migrations run automatically on harness boot with rollback safety.
5. **Startup Worker Reconciliation**:
   On server initialization, any tasks remaining in `running` status with dead process PIDs or past timeout thresholds are transitioned to `abandoned` status and a synthetic diagnostic mailbox event is queued for the parent session.

## Alternatives considered

- **Remain on filesystem JSON/JSONL snapshots with file locking**: Rejected because file locks across multiple files do not provide rollback semantics, are notoriously flaky across OS platforms (POSIX vs Windows NTFS), and prevent transactional consistency.
- **External PostgreSQL / MySQL database**: Rejected because Agent Harness is an embeddable, developer-first orchestration application designed to run locally with zero infrastructure dependencies.
- **Embedded Key-Value Store (e.g., LevelDB/RocksDB)**: Rejected because key-value engines do not provide relational joins, query indexing for metadata listing, or built-in schema migrations without extensive custom application code.

## Consequences

- Full ACID guarantees (Atomicity, Consistency, Isolation, Durability) for all session, message, task, and mailbox operations.
- Single-transaction mailbox drain completely eliminates mailbox duplicate delivery and lost completion edge cases.
- Fast metadata indexing and queries without directory traversal overhead.
- Single file storage (`.harness/harness.db`) simplifies backups, migrations, and export/import workflows.
- Core persistence utilizes native embedded `node:sqlite` (`DatabaseSync`), requiring zero native C++ compiler toolchains while defining `ISqliteDatabase` driver interfaces for future pluggability.

## Evidence and supersession

Expands on principles #1, #2, #3, and #9 in `docs/architecture/TARGET_DIRECTION.md` and supersedes file-based single-writer conventions documented in `docs/architecture/CURRENT_STATE.md`.
