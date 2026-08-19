---
summary: Phased implementation plan for OpenTelemetry tracing, Prometheus metrics, pluggable logging sinks, and cryptographic audit trails.
read_when:
  - Implementing OpenTelemetry tracing, Prometheus metrics, and audit log features in Agent Harness.
  - Reviewing the rollout sequence for telemetry and audit infrastructure.
---

# Observability, Audit Trails, and Metrics Implementation Plan

Status: Draft

## Inputs

- Governing Specification: `specs/observability-audit-metrics/SPEC.md`
- Governing ADR: `docs/decisions/0005-tamper-evident-audit-and-opentelemetry-observability.md`
- Current Codebase: `packages/core/src/contracts/logging.ts`, `packages/server/src/routes/chat.ts`, `packages/server/src/app.ts`

## Sequence

### Phase 1: OpenTelemetry Contracts & Server Tracer
- **Objective**: Define browser-safe tracing contracts and wire OpenTelemetry Node.js SDK on the server.
- **Files/Symbols**:
  - [NEW] `packages/core/src/contracts/tracing.ts`
  - [NEW] `packages/server/src/telemetry/tracer.ts`
  - [NEW] `packages/server/src/telemetry/tracer.test.ts`
  - [MODIFY] `packages/server/src/routes/chat.ts`
- **Behavior**: Extracts incoming `traceparent` or generates trace context, wraps request handling in root span.
- **Verification**: `vitest run packages/server/src/telemetry/tracer.test.ts`.

### Phase 2: Runtime, Provider & Tool Span Instrumentation
- **Objective**: Instrument `SessionRuntime`, LLM client, and `ToolRegistry` with child spans.
- **Files/Symbols**:
  - [MODIFY] `packages/core/src/agent/session-runtime.ts`
  - [MODIFY] `packages/core/src/llm/client.ts`
  - [MODIFY] `packages/core/src/tool/registry.ts`
  - [NEW] `packages/core/src/telemetry/spans.test.ts`
- **Behavior**: Propagates trace context across runtime promises and tool execution callbacks.
- **Verification**: `vitest run packages/core/src/telemetry/spans.test.ts`.

### Phase 3: Prometheus Metrics Registry & Histograms
- **Objective**: Implement Prometheus metric collectors and expose `/api/metrics`.
- **Files/Symbols**:
  - [NEW] `packages/server/src/telemetry/metrics.ts`
  - [NEW] `packages/server/src/telemetry/metrics.test.ts`
  - [MODIFY] `packages/server/src/routes/metrics.ts`
- **Behavior**: Records token counts, TTFT histograms, tool duration histograms, and queue gauges.
- **Verification**: `vitest run packages/server/src/telemetry/metrics.test.ts`.

### Phase 4: Tamper-Evident Cryptographic Audit Ledger & CLI
- **Objective**: Implement SHA-256 hash-chained `audit_events` ledger and verification command.
- **Files/Symbols**:
  - [NEW] `packages/core/src/audit/audit-ledger.ts`
  - [NEW] `packages/core/src/audit/audit-ledger.test.ts`
  - [NEW] `scripts/verify-audit-log.mjs`
  - [NEW] `scripts/verify-audit-log.test.mts`
  - [MODIFY] `package.json` (add `npm run audit:verify`)
- **Behavior**: Records hash-chained security events on privileged tool executions and agent modifications; verification script detects any ledger mutation.
- **Verification**: `corepack pnpm run audit:verify` and unit tests.

## Risks and compatibility

- **Performance overhead**: Tracing and metric recording are non-blocking and in-memory; audit logging appends to SQLite in WAL mode with indexed sequence keys.
- **Privacy & Security**: Audit payloads sanitize API keys, bearer tokens, and sensitive credentials before computing hashes.

## Completion evidence

- `corepack pnpm test` passes with all tracing, metrics, and audit tests green.
- `GET /api/metrics` returns valid Prometheus scrape format.
- `corepack pnpm run audit:verify` passes on valid ledger and fails on injected tampering.
- `corepack pnpm run check` passes completely.
