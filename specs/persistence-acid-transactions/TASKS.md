---
summary: Implementation task breakdown and acceptance evidence tracking for SQLite WAL persistence and ACID transactions.
read_when:
  - Tracking task execution for SQLite storage, migrations, and atomic mailbox drain in Agent Harness.
  - Reviewing task dependencies, verification commands, and completion criteria.
---

# Persistence and ACID Transactions Tasks

- [x] **T01 - Database Driver, WAL Pragmas, and Connection Factory**
  - Depends on: none
  - Scope: Add embedded SQLite driver abstraction to `@agent-harness/core`, implement `ISqliteDatabase` / `IDatabaseDriver` interface in `packages/core/src/persistence/sqlite/types.ts` and `SqliteDatabaseDriver` in `packages/core/src/persistence/sqlite/db.ts`. Configure WAL mode, normal synchronous, busy timeout (5000ms), and 64MB cache.
  - Acceptance: Connection initializes `.harness/harness.db` with configured pragmas. In-memory connection works for tests.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/db.test.ts`
  - Docs/handoff: Update `docs/architecture/CURRENT_STATE.md` with SQLite storage engine entry.

- [x] **T02 - Schema Migrations Runner and Baseline 001 DDL**
  - Depends on: T01
  - Scope: Create `SqliteMigrator` in `packages/core/src/persistence/sqlite/migrator.ts` and migration files `001_initial_schema.sql` / `001_initial_schema.down.sql` defining `schema_migrations`, `sessions`, `runs`, `messages`, `tasks`, `mailbox_events`, and `open_sessions`.
  - Acceptance: Running migrator creates all tables, foreign keys, and indexes idempotently; down migration cleanly drops tables; SHA-256 checksum mismatch is detected.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/migrator.test.ts`
  - Docs/handoff: Record baseline migration version in `SPEC.md`.

- [x] **T03 - Relational Entity Repositories and Domain Mapping**
  - Depends on: T02
  - Scope: Implement `SessionRepository`, `RunRepository`, `MessageRepository`, `TaskRepository`, `MailboxRepository`, and `OpenSessionsRepository` in `packages/core/src/persistence/sqlite/`.
  - Acceptance: Strict boundary validation on writes; monotonic sequence numbering on messages; cascade delete cleans child records.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/repositories.test.ts`
  - Docs/handoff: Export repository interfaces from `@agent-harness/core/persistence`.

- [x] **T04 - Transactional Mailbox Drain in SessionRuntime**
  - Depends on: T03
  - Scope: Modify `SessionRuntime.deliver()` and `delegation.ts` in `packages/core/src/agent/` to use `MailboxRepository.drainPendingEvents()` inside an atomic `BEGIN IMMEDIATE` transaction.
  - Acceptance: System message materialization and mailbox event acknowledgement commit atomically. Thrown errors leave zero uncommitted messages and preserve pending events.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/agent/session-runtime.test.ts`
  - Docs/handoff: Update `docs/DELEGATE_FEATURE_SPEC.md` reflecting atomic mailbox drain.

- [x] **T05 - Legacy Data Migration Pipeline & Quarantine**
  - Depends on: T03, T04
  - Scope: Implement `LegacyMigrator` in `packages/core/src/persistence/sqlite/legacy-migrator.ts` scanning `.json` and `.mailbox.jsonl` files, backing up to `.harness/legacy_backup_<timestamp>/`, quarantining corrupted files to `.invalid-*`, and loading validated records into SQLite in a single transaction.
  - Acceptance: 100% entity parity on legacy imports; corrupted files quarantined without failing valid session imports; rollback restores original state on error.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/legacy-migrator.test.ts`
  - Docs/handoff: Add legacy migration guide to `SPEC.md`.

- [x] **T06 - Startup Worker Reconciliation & Server Lifecycle Integration**
  - Depends on: T04, T05
  - Scope: Update `SessionManager.initialize()` in `packages/server/src/session-manager.ts` to query orphaned `running` / `queued` tasks, transition to `abandoned`, insert diagnostic mailbox events, and notify parent sessions on wake. Update Express session routes.
  - Acceptance: Orphaned tasks cleanly transitioned to `abandoned` on boot; parent session delivers failure card upon next load.
  - Verify: `corepack pnpm --filter @agent-harness/server test`
  - Docs/handoff: Update `SessionManager` lifecycle documentation.

- [x] **T07 - Concurrency Hardening, Fault Injection & Performance Benchmarks**
  - Depends on: T01-T06
  - Scope: Implement `withDbRetry` in `packages/core/src/persistence/sqlite/concurrency.ts`. Add fault injection tests (SIGKILL simulation, transaction rollback) and 10,000 session metadata benchmark test.
  - Acceptance: 50 concurrent transactions complete with zero `SQLITE_BUSY` errors; `GET /api/sessions/meta` on 10,000 sessions responds in `< 10ms`.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/benchmark.test.ts`
  - Docs/handoff: Run `corepack pnpm run check` and verify entire test suite passes.
