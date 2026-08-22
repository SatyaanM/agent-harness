---
summary: Phased implementation plan for OpenTelemetry tracing, Prometheus metrics, pluggable logging sinks, and cryptographic audit trails.
read_when:
  - Implementing OpenTelemetry tracing, Prometheus metrics, and audit log features in Agent Harness.
  - Reviewing the rollout sequence for telemetry and audit infrastructure.
---

# Observability, Audit Trails, and Metrics Implementation Plan

Status: Completed

## Inputs

- Governing Specification: `specs/observability-audit-metrics/SPEC.md`
- Governing ADR: `docs/decisions/0005-tamper-evident-audit-and-opentelemetry-observability.md`
- Current Codebase: `packages/core/src/contracts/`, `packages/server/src/routes/`, `packages/core/src/persistence/sqlite/`

## Sequence

### Phase 1: Core Tracing Contracts & W3C Propagation
- **Objective**: Implement browser-safe tracing types and W3C `traceparent` extraction/injection in `@agent-harness/core`.
- **Files/Symbols**:
  - [NEW] `packages/core/src/contracts/tracing.ts` (`ITracer`, `ISpan`, `ITraceContext`, `W3CTraceContext`, `NoopTracer`, `NoopSpan`)
  - [NEW] `packages/core/src/contracts/tracing.test.ts`
  - [MODIFY] `packages/core/src/contracts/index.ts`
  - [MODIFY] `packages/core/src/index.ts`
- **Behavior**: Pure TypeScript tracing contracts without Node/OTel SDK dependencies; extracts and injects W3C headers deterministically.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/contracts/tracing.test.ts`.

### Phase 2: Server OpenTelemetry SDK Adapter & Tracer Initialization
- **Objective**: Implement OTel Node SDK adapter and initialize tracing on server boot.
- **Files/Symbols**:
  - [NEW] `packages/server/src/telemetry/tracer.ts` (`OTelTracerAdapter`, `OTelSpanAdapter`, `initTelemetry`, `shutdownTelemetry`)
  - [NEW] `packages/server/src/telemetry/tracer.test.ts`
  - [MODIFY] `packages/server/src/index.ts` (call `initTelemetry` on boot, `shutdownTelemetry` on close)
- **Behavior**: Bridges OpenTelemetry Node SDK to `@agent-harness/core` contracts; enables OTLP HTTP exporting when configured.
- **Verification**: `corepack pnpm --filter @agent-harness/server test packages/server/src/telemetry/tracer.test.ts`.

### Phase 3: Distributed Span Instrumentation Across Agent & Tools
- **Objective**: Instrument `chatRouter`, `SessionRuntime`, `Agent`, `ToolRegistry`, and `Worker` delegation with child spans.
- **Files/Symbols**:
  - [MODIFY] `packages/server/src/routes/chat.ts` (extract incoming `traceparent`, create root server span)
  - [MODIFY] `packages/core/src/agent/session-runtime.ts` (span `session.deliver`, span `session.mailbox_drain`)
  - [MODIFY] `packages/core/src/agent/agent.ts` (span `agent.run`, span `agent.step`, span `gen_ai.chat`, span `tool.execute`)
  - [MODIFY] `packages/core/src/agent/delegation.ts` (inject trace context into worker delegation carrier)
  - [MODIFY] `packages/core/src/agent/worker.ts` (span `worker.run` with `SpanLink` to delegator)
  - [NEW] `packages/core/src/telemetry/spans.test.ts`
- **Behavior**: Full trace context propagation across asynchronous boundaries and worker executions.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/telemetry/spans.test.ts`.

### Phase 4: Prometheus / OpenMetrics Registry & HTTP Endpoint
- **Objective**: Implement high-throughput, zero-dependency metrics registry and mount `GET /api/metrics`.
- **Files/Symbols**:
  - [NEW] `packages/server/src/telemetry/metrics.ts` (`MetricRegistry`, `Counter`, `Gauge`, `Histogram`)
  - [NEW] `packages/server/src/telemetry/sanitization.ts` (label bounding, agent/model sanitization)
  - [NEW] `packages/server/src/telemetry/index.ts` (singleton metric definitions)
  - [NEW] `packages/server/src/telemetry/metrics.test.ts`
  - [NEW] `packages/server/src/routes/metrics.ts` (OpenMetrics and Prometheus text exposition)
  - [NEW] `packages/server/src/routes/metrics.test.ts`
  - [MODIFY] `packages/server/src/app.ts` (mount `/api/metrics`)
- **Behavior**: Exposes Prometheus metrics with histogram buckets and label cardinality protection.
- **Verification**: `corepack pnpm --filter @agent-harness/server test packages/server/src/telemetry/metrics.test.ts`.

### Phase 5: Cryptographic Audit Ledger & SQLite Migration
- **Objective**: Implement tamper-evident SHA-256 hash-chained `audit_events` ledger and secret redaction pipeline.
- **Files/Symbols**:
  - [NEW] `packages/core/src/persistence/sqlite/migrations/002_audit_events.sql`
  - [NEW] `packages/core/src/persistence/sqlite/migrations/002_audit_events.down.sql`
  - [MODIFY] `packages/core/src/persistence/sqlite/migrator.ts` (register migration 002)
  - [NEW] `packages/core/src/crypto/canonical-json.ts` (deterministic sorted key serialization)
  - [NEW] `packages/core/src/crypto/audit-hash.ts` (SHA-256 hash chaining)
  - [NEW] `packages/core/src/crypto/redaction.ts` (secret scrubbing and 64KB size bounding)
  - [NEW] `packages/core/src/persistence/sqlite/audit-repo.ts` (`AuditRepository.append`, `list`, `get`)
  - [NEW] `packages/core/src/persistence/sqlite/audit-repo.test.ts`
  - [MODIFY] `packages/core/src/persistence/sqlite/index.ts`
- **Behavior**: Appends SHA-256 chained audit entries in atomic SQLite `IMMEDIATE` transactions.
- **Verification**: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/audit-repo.test.ts`.

### Phase 6: Audit Event Instrumentation in Routes & Privileged Tools
- **Objective**: Hook security-critical operations to append audit events automatically.
- **Files/Symbols**:
  - [MODIFY] `packages/server/src/routes/sessions.ts` (`session.create`, `session.delete`, `session.rename`)
  - [MODIFY] `packages/server/src/routes/agents.ts` (`agent.create`, `agent.update`, `agent.delete`)
  - [MODIFY] `packages/server/src/routes/settings.ts` (`settings.update`)
  - [MODIFY] `packages/core/src/tool/` (audit shell command execution, file write, file delete, web fetch)
  - [NEW] `packages/server/src/routes/audit-integration.test.ts`
- **Behavior**: All administrative and privileged actions produce immutable audit log entries.
- **Verification**: `corepack pnpm --filter @agent-harness/server test packages/server/src/routes/audit-integration.test.ts`.

### Phase 7: Verification CLI & Integrity Test Suite
- **Objective**: Build $O(1)$-memory verification CLI script to validate ledger integrity.
- **Files/Symbols**:
  - [NEW] `scripts/verify-audit-log.mjs`
  - [NEW] `scripts/verify-audit-log.test.mts`
  - [MODIFY] `package.json` (add `"audit:verify": "node scripts/verify-audit-log.mjs"`)
- **Behavior**: Scans `audit_events` from genesis to tip; flags any record alteration, sequence gap, or tampering.
- **Verification**: `corepack pnpm run audit:verify` and `vitest run scripts/verify-audit-log.test.mts`.

### Phase 8: Quality Gates & Full Verification
- **Objective**: Run complete repository verification suite, docs check, and Knip validation.
- **Verification**: `corepack pnpm run check`.

## Risks and compatibility

- **Zero Browser Dependencies**: Contracts package must not import Node.js `crypto` or OpenTelemetry SDK modules.
- **Concurrency Safety**: Audit appends must use `immediateTransaction` with `withDbRetry` to prevent `SQLITE_BUSY` errors under high concurrent load.
- **Data Redaction**: Secret scrubbing must execute prior to hash calculation to prevent storing unredacted secrets in verifiable preimages.

## Completion evidence

- `corepack pnpm test` passes all new unit, integration, and performance tests.
- `GET /api/metrics` returns valid Prometheus scrape format.
- `corepack pnpm run audit:verify` succeeds on valid chains and detects injected tampering.
- `corepack pnpm run check` passes completely.
