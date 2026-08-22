---
summary: Implementation task breakdown and acceptance evidence tracking for OpenTelemetry tracing, Prometheus metrics, and cryptographic audit logs.
read_when:
  - Tracking task execution for observability, metrics, and audit ledger in Agent Harness.
  - Reviewing task dependencies, verification commands, and completion criteria.
---

# Observability, Audit Trails, and Metrics Tasks

- [x] **T01 - Browser-Safe Tracing Contracts & W3C Trace Context**
  - Depends on: none
  - Scope: Create `packages/core/src/contracts/tracing.ts` defining `ITracer`, `ISpan`, `ITraceContext`, `SpanAttributes`, `SpanKind`, `SpanStatusCode`, `NoopTracer`, `NoopSpan`, and `W3CTraceContext` parser/serializer. Export from `@agent-harness/core/contracts`.
  - Acceptance: Contracts have zero Node.js/OTel dependencies; W3C `traceparent` correctly validates, serializes, and deserializes headers.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/contracts/tracing.test.ts`
  - Docs/handoff: Update core contracts exports.

- [x] **T02 - OpenTelemetry Node.js SDK Adapter & Tracer Lifecycle**
  - Depends on: T01
  - Scope: Implement `OTelTracerAdapter` and `OTelSpanAdapter` in `packages/server/src/telemetry/tracer.ts`. Wire `initTelemetry()` and `shutdownTelemetry()` with `NodeTracerProvider`, `AsyncLocalStorageContextManager`, and `OTLPTraceExporter`.
  - Acceptance: Tracer bridges OTel SDK to `@agent-harness/core` interfaces; non-blocking fallback when OTel is disabled.
  - Verify: `corepack pnpm --filter @agent-harness/server test packages/server/src/telemetry/tracer.test.ts`
  - Docs/handoff: Document environment variables in `SPEC.md`.

- [x] **T03 - Distributed Span Instrumentation across HTTP, Runtime, LLM & Delegation**
  - Depends on: T01, T02
  - Scope: Instrument `packages/server/src/routes/chat.ts`, `packages/core/src/agent/session-runtime.ts`, `packages/core/src/agent/agent.ts`, `packages/core/src/agent/delegation.ts`, and `packages/core/src/agent/worker.ts` with hierarchical child spans, GenAI semantic conventions, and span links.
  - Acceptance: Inbound `traceparent` creates root span; worker tasks inherit trace context asynchronously; agent step/LLM/tool spans link cleanly.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/telemetry/spans.test.ts`
  - Docs/handoff: Verify span hierarchy diagram in `SPEC.md`.

- [x] **T04 - Prometheus / OpenMetrics Registry & Label Sanitization**
  - Depends on: none
  - Scope: Implement `MetricRegistry`, `Counter`, `Gauge`, `Histogram` in `packages/server/src/telemetry/metrics.ts` and label sanitization in `packages/server/src/telemetry/sanitization.ts`. Define global metrics (`tokens_total`, `llm_duration_seconds`, `ttft_seconds`, `tool_duration_seconds`, `concurrency_active_runs`, `concurrency_queue_depth`, `mailbox_events_total`, `sessions_total`).
  - Acceptance: Zero-dependency metric collection, correct histogram cumulative bucket accumulation, and strict label cardinality bounds.
  - Verify: `corepack pnpm --filter @agent-harness/server test packages/server/src/telemetry/metrics.test.ts`
  - Docs/handoff: Update server telemetry exports.

- [x] **T05 - Prometheus HTTP Endpoint & Metric Instrumentation**
  - Depends on: T04
  - Scope: Create `packages/server/src/routes/metrics.ts` and mount at `/api/metrics` in `app.ts`. Instrument `Agent.run` (token usage, LLM duration, tool duration) and `SessionRuntime` / `SessionManager` (concurrency gauges, mailbox counters, session counts).
  - Acceptance: `GET /api/metrics` returns valid Prometheus/OpenMetrics text format; response time < 5ms.
  - Verify: `corepack pnpm --filter @agent-harness/server test packages/server/src/routes/metrics.test.ts`
  - Docs/handoff: Test endpoint using curl/fetch.

- [x] **T06 - Cryptographic Audit Ledger Schema, Canonical JSON & SHA-256 Hashing**
  - Depends on: none
  - Scope: Add migration `002_audit_events.sql` / `002_audit_events.down.sql` to `packages/core/src/persistence/sqlite/migrations/`. Implement `canonicalJsonStringify` in `packages/core/src/crypto/canonical-json.ts`, `computeAuditEventHash` in `packages/core/src/crypto/audit-hash.ts`, secret redaction in `packages/core/src/crypto/redaction.ts`, and `AuditRepository` in `packages/core/src/persistence/sqlite/audit-repo.ts`.
  - Acceptance: Sequential SHA-256 hash chaining links to genesis; canonical JSON ensures deterministic key order; secret redaction scrubs credentials before hashing.
  - Verify: `corepack pnpm --filter @agent-harness/core test packages/core/src/persistence/sqlite/audit-repo.test.ts`
  - Docs/handoff: Update SQLite migrator with version 2.

- [x] **T07 - Audit Event Instrumentation across Server Routes & Privileged Tools**
  - Depends on: T06
  - Scope: Record audit events for `session.create`, `session.delete`, `session.rename` in `packages/server/src/routes/sessions.ts`, `agent.create`, `agent.update`, `agent.delete` in `packages/server/src/routes/agents.ts`, `settings.update` in `packages/server/src/routes/settings.ts`, and privileged tool executions (`runCommand`, `writeFile`, `editFile`, `webFetch`).
  - Acceptance: All administrative and privileged actions produce immutable audit log entries in SQLite.
  - Verify: `corepack pnpm --filter @agent-harness/server test packages/server/src/routes/audit-integration.test.ts`
  - Docs/handoff: Verify action taxonomy in `SPEC.md`.

- [x] **T08 - Streaming Audit Verification CLI & Integrity Test Matrix**
  - Depends on: T06, T07
  - Scope: Create `scripts/verify-audit-log.mjs` and test suite `scripts/verify-audit-log.test.mts`. Add `"audit:verify": "node scripts/verify-audit-log.mjs"` to root `package.json`.
  - Acceptance: Streams entries with $O(1)$ memory; returns exit code 0 on valid ledger; returns exit code 1 with exact sequence number and field on modified, deleted, or inserted rows.
  - Verify: `corepack pnpm run audit:verify` and `vitest run scripts/verify-audit-log.test.mts`
  - Docs/handoff: Run full repository quality and check suite (`corepack pnpm run check`).
