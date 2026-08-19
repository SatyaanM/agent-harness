---
summary: Specification for OpenTelemetry distributed tracing, Prometheus/OpenMetrics histograms, and tamper-evident cryptographic audit logs.
read_when:
  - Designing or implementing telemetry, OpenTelemetry spans, Prometheus metrics, or security audit logs.
  - Reviewing observability contracts and compliance verification mechanisms.
---

# Observability, Audit Trails, and Metrics Specification

Status: Proposed

## Problem and evidence

1. **Opaque Multi-Agent Tracing**: While ephemeral `runId` and `requestId` are logged via ADR 0003, there is no standardized W3C `traceparent` context propagation. Complex execution flows traversing HTTP requests, WebSocket events, subagent worker delegations, LLM provider API calls, and tool invocations cannot be visualized in APM tools (Jaeger, Datadog, Zipkin).
2. **Missing Granular Performance Metrics**: Telemetry currently lacks histograms for Time-To-First-Token (TTFT), token generation rates, tool execution latencies, and execution concurrency pool saturation.
3. **Repudiation and Forensic Risk**: Security-critical actions (executing shell commands, writing filesystem files, mutating agent prompts, deleting sessions) are only recorded as ephemeral console logs. An administrator or security auditor cannot prove that log records were not deleted or modified after an incident.

## Goals and non-goals

### Goals
- Implement W3C `traceparent` context propagation and OpenTelemetry distributed tracing across HTTP, SessionRuntime, Worker, Provider, and Tool layers.
- Implement an OpenMetrics/Prometheus endpoint at `GET /api/metrics` with standard counters, gauges, and latency histograms.
- Implement a tamper-evident, append-only cryptographic audit log in SQLite (`audit_events`) using SHA-256 hash chaining.
- Build an audit verification CLI (`corepack pnpm run audit:verify`) that recalculates the Merkle hash chain from genesis to prove ledger integrity.
- Provide pluggable logger sinks in `@agent-harness/core/contracts/logging.ts` (console stdout, daily rotating file sinks, and OTel LogRecord exporters).

### Non-goals
- Forcing external APM infrastructure for local development (OpenTelemetry tracing operates with a local no-op or stdout exporter by default).
- Persisting raw LLM prompt text in plain-text audit logs (audit payloads are sanitized for secret/PII containment).

## Required behavior

### 1. OpenTelemetry Distributed Tracing Architecture
- Abstract tracing contracts in `@agent-harness/core/contracts/tracing.ts` (browser-safe).
- Concrete OpenTelemetry Node.js SDK setup in `@agent-harness/server/src/telemetry/otel.ts`.
- Span Hierarchy:
  ```text
  [HTTP POST /api/chat] (Span: http.server)
    └── [SessionRuntime.deliver] (Span: session.deliver)
          ├── [Mailbox.drain] (Span: mailbox.drain)
          └── [Agent.run] (Span: agent.run)
                ├── [LLM.generate (model: claude-3-5-sonnet)] (Span: llm.generate)
                ├── [Tool.runCommand (cmd: git status)] (Span: tool.execution)
                └── [Delegate.spawnWorker (task: task-101)] (Span: worker.spawn)
                      └── [Worker.run] (Span: worker.run)
  ```

### 2. Prometheus / OpenMetrics Telemetry (`GET /api/metrics`)
Exposed metrics:
- `agent_harness_tokens_total{agent, model, type="prompt|completion|cached"}` (Counter)
- `agent_harness_llm_duration_seconds_bucket{agent, model, status="success|error"}` (Histogram: 0.1, 0.5, 1, 2, 5, 10, 30s)
- `agent_harness_ttft_seconds_bucket{agent, model}` (Histogram: 0.05, 0.1, 0.25, 0.5, 1, 2s)
- `agent_harness_tool_duration_seconds_bucket{tool, status="success|error"}` (Histogram)
- `agent_harness_concurrency_active_runs` (Gauge)
- `agent_harness_concurrency_queue_depth` (Gauge)
- `agent_harness_mailbox_events_total{status="acknowledged|rejected"}` (Counter)

### 3. Tamper-Evident Cryptographic Audit Ledger
Table schema:
```sql
CREATE TABLE audit_events (
  seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'worker', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('session.create', 'session.delete', 'agent.create', 'agent.update', 'agent.delete', 'tool.exec.shell', 'tool.exec.file_write', 'tool.exec.file_delete', 'settings.update')),
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload TEXT NOT NULL, -- Canonical JSON string
  signature TEXT -- Optional HMAC/Ed25519 signature
);
```

#### Hash Chaining Algorithm
```ts
function computeAuditHash(prevHash: string, event: AuditEventInput): string {
  const canonicalPayload = canonicalJsonStringify(event.payload);
  const data = [
    prevHash,
    event.timestamp.toString(),
    event.actorType,
    event.actorId,
    event.action,
    event.resourceType,
    event.resourceId,
    canonicalPayload,
  ].join("|");
  return crypto.createHash("sha256").update(data).digest("hex");
}
```

### 4. Verification CLI (`corepack pnpm run audit:verify`)
- Scans `audit_events` from `seq_id = 1` to `MAX(seq_id)`.
- Recomputes each hash based on the previous block's hash.
- Throws an integrity error specifying the exact mutated block if any mismatch is found.

## Acceptance criteria

1. **OTel Context Propagation**: W3C `traceparent` headers received on `/api/chat` propagate into tool execution spans and background worker traces.
2. **Prometheus Scraping**: Standard Prometheus scraper consumes `/api/metrics` without syntax errors.
3. **Audit Immutability**: Any direct modification to `payload` or deletion of a row in `audit_events` is immediately detected and flagged by `corepack pnpm run audit:verify`.
4. **Zero Browser Pollution**: Contracts package remains 100% free of Node.js-only tracing or crypto dependencies.

## Open questions and decisions

- Governing ADR: `docs/decisions/0005-tamper-evident-audit-and-opentelemetry-observability.md`.
- Export sinks: Default to stdout / Prometheus scrapers; allow OTLP gRPC/HTTP exporter configuration via environment variables (`OTEL_EXPORTER_OTLP_ENDPOINT`).
