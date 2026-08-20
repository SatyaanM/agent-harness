---
summary: Phased implementation plan for SQLite WAL persistence, schema migrations, transactional mailbox drain, legacy migration, and startup reconciliation.
read_when:
  - Executing implementation tasks for SQLite database integration in Agent Harness.
  - Reviewing the rollout sequence for ACID persistence and data migration.
---

# Persistence and ACID Transactions Implementation Plan

Status: Completed

## Inputs

- Governing Specification: `specs/persistence-acid-transactions/SPEC.md`
- Governing ADR: `docs/decisions/0004-acid-storage-and-relational-persistence.md`
- Delegate Feature Spec: `docs/DELEGATE_FEATURE_SPEC.md`
- Current Codebase: `packages/core/src/persistence/session.ts`, `packages/core/src/agent/session-runtime.ts`, `packages/server/src/session-manager.ts`, `packages/server/src/open-sessions.ts`

## Sequence

### Phase 1: Database Driver, Connection Factory & Migrations Engine
- **Objective**: Add embedded SQLite driver (`better-sqlite3`), connection lifecycle singleton with WAL mode pragmas, and transactional SQL migration runner.
- **Files/Symbols**:
  - [MODIFY] `packages/core/package.json` (add `better-sqlite3`, `@types/better-sqlite3`)
  - [NEW] `packages/core/src/persistence/sqlite/types.ts` (`ISqliteDatabase`, `IDatabaseDriver`, row interfaces)
  - [NEW] `packages/core/src/persistence/sqlite/db.ts` (`DatabaseConnection`, `withTransaction`, `withImmediateTransaction`)
  - [NEW] `packages/core/src/persistence/sqlite/migrator.ts` (`SqliteMigrator`, `schema_migrations` tracking)
  - [NEW] `packages/core/src/persistence/sqlite/migrations/001_initial_schema.sql` (Relational DDL, constraints, indexes)
  - [NEW] `packages/core/src/persistence/sqlite/migrations/001_initial_schema.down.sql` (Reversible drop statements)
  - [NEW] `packages/core/src/persistence/sqlite/migrator.test.ts`
- **Behavior**: Initializes SQLite at `.harness/harness.db` with `PRAGMA journal_mode = WAL`, `PRAGMA synchronous = NORMAL`, `PRAGMA foreign_keys = ON`, `PRAGMA busy_timeout = 5000`, `PRAGMA cache_size = -64000`, `PRAGMA mmap_size = 268435456`, and `PRAGMA temp_store = MEMORY`. Applies unapplied versioned migrations inside transactions.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/migrator.test.ts`.

### Phase 2: Relational Repositories & Typed Data Access Layer
- **Objective**: Implement strongly typed repository classes for sessions, runs, messages, tasks, mailbox events, and open sessions.
- **Files/Symbols**:
  - [NEW] `packages/core/src/persistence/sqlite/session-repo.ts` (`SessionRepository`)
  - [NEW] `packages/core/src/persistence/sqlite/run-repo.ts` (`RunRepository`)
  - [NEW] `packages/core/src/persistence/sqlite/message-repo.ts` (`MessageRepository`)
  - [NEW] `packages/core/src/persistence/sqlite/task-repo.ts` (`TaskRepository`)
  - [NEW] `packages/core/src/persistence/sqlite/mailbox-repo.ts` (`MailboxRepository`)
  - [NEW] `packages/core/src/persistence/sqlite/open-sessions-repo.ts` (`OpenSessionsRepository`)
  - [NEW] `packages/core/src/persistence/sqlite/repositories.test.ts`
- **Behavior**: Implements type-safe CRUD operations, monotonic message sequencing, and cascaded deletions across related entities.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/repositories.test.ts`.

### Phase 3: Transactional Mailbox Drain & SessionRuntime Integration
- **Objective**: Integrate transactional mailbox drain into `SessionRuntime.deliver()` and worker delegation.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/session-runtime.ts`
  - [MODIFY] `packages/core/src/agent/delegation.ts`
  - [MODIFY] `packages/core/src/agent/session-runtime.test.ts`
  - [MODIFY] `packages/core/src/agent/delegation.test.ts`
- **Behavior**: Executes mailbox event extraction, message materialization, user prompt insertion, and mailbox acknowledgment inside a single atomic `BEGIN IMMEDIATE` SQLite transaction.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/agent/session-runtime.test.ts`.

### Phase 4: Legacy Data Migration Pipeline & Quarantine
- **Objective**: Build an automated, zero-data-loss migration pipeline from legacy JSON/JSONL files into SQLite.
- **Files/Symbols**:
  - [NEW] `packages/core/src/persistence/sqlite/legacy-migrator.ts`
  - [NEW] `packages/core/src/persistence/sqlite/legacy-migrator.test.ts`
- **Behavior**: Scans `<sessionsDir>` for `*.json` and `*.mailbox.jsonl`, creates pre-migration backup in `.harness/legacy_backup_<timestamp>/`, quarantines corrupted files to `.invalid-<timestamp>-<uuid>`, inserts validated records into SQLite inside a single workspace transaction, and verifies integrity before archiving legacy files.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/legacy-migrator.test.ts`.

### Phase 5: Startup Worker Task Reconciliation Protocol
- **Objective**: Implement orphaned task reconciliation and parent session notification on server boot.
- **Files/Symbols**:
  - [MODIFY] `packages/server/src/session-manager.ts`
  - [MODIFY] `packages/server/src/server.ts`
  - [MODIFY] `packages/server/src/routes/sessions.ts`
  - [MODIFY] `packages/server/src/session-manager.test.ts`
  - [MODIFY] `packages/server/src/routes/sessions.test.ts`
- **Behavior**: During `SessionManager.initialize()`, transitions any orphaned `running` or `queued` tasks to `abandoned`, inserts diagnostic mailbox events into `mailbox_events`, and triggers wake deliveries when parent sessions load.
- **Verification**: `corepack pnpm --filter @agent-harness/server test`.

### Phase 6: Concurrency Hardening, Fault Injection & Benchmarks
- **Objective**: Verify system durability under simulated crashes and lock contention; validate performance metrics.
- **Files/Symbols**:
  - [NEW] `packages/core/src/persistence/sqlite/concurrency.ts` (`withDbRetry` exponential backoff)
  - [NEW] `packages/core/src/persistence/sqlite/fault-injection.test.ts`
  - [NEW] `packages/core/src/persistence/sqlite/benchmark.test.ts`
- **Behavior**: Validates that 50 concurrent transactions complete with zero errors, simulated mid-turn process kills leave zero corrupted state, and `GET /api/sessions/meta` on 10,000 sessions responds in `< 10ms`.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/benchmark.test.ts`.

## Risks and Compatibility

- **Native Binary Compilation**: `better-sqlite3` compiles prebuilt binaries via `node-gyp` across Windows, macOS, and Linux. The database wrapper interface is decoupled to allow seamless fallback to `@libsql/client` or `sql.js` if WASM-only environments are targeted in the future.
- **Backward Compatibility**: Legacy `.json` files are backed up before migration and safely archived. Diagnostic quarantine ensures unparseable legacy files do not prevent valid session migration.

## Completion Evidence

- `corepack pnpm test` passes across all packages with 100% green tests.
- Simulated crash mid-mailbox drain leaves zero uncommitted records and preserves all mailbox events as `pending`.
- 10,000 session metadata query benchmark executes in `< 10ms`.
- `corepack pnpm run check` passes completely.
