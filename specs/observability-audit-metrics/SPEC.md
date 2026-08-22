---
summary: Specification for OpenTelemetry distributed tracing, Prometheus/OpenMetrics telemetry, and tamper-evident cryptographic audit logs.
read_when:
  - Designing or implementing telemetry, OpenTelemetry spans, Prometheus metrics, or security audit logs.
  - Reviewing observability contracts and compliance verification mechanisms.
---

# Observability, Audit Trails, and Metrics Specification

Status: Implemented

## Problem and evidence

1. **Opaque Multi-Agent Tracing**: While ephemeral `runId` and `requestId` are logged via ADR 0003, there is no standardized W3C `traceparent` context propagation. Complex execution flows traversing HTTP requests, WebSocket events, subagent worker delegations, LLM provider API calls, and tool invocations cannot be visualized in APM tools (Jaeger, Datadog, Zipkin, Honeycomb).
2. **Missing Granular Performance Metrics**: Telemetry currently lacks histograms for Time-To-First-Token (TTFT), token generation rates, tool execution latencies, provider latencies, and execution concurrency pool saturation.
3. **Repudiation and Forensic Risk**: Security-critical actions (executing shell commands, writing filesystem files, mutating agent prompts, deleting sessions) are only recorded as ephemeral console logs. An administrator or security auditor cannot mathematically prove that log records were not deleted, modified, or reordered after an incident.

## Goals and non-goals

### Goals
- Implement W3C `traceparent` context propagation and browser-safe OpenTelemetry distributed tracing across HTTP, SessionRuntime, Worker, Provider, and Tool layers.
- Implement an OpenMetrics/Prometheus endpoint at `GET /api/metrics` with standard counters, gauges, and latency histograms with label cardinality protection.
- Implement a tamper-evident, append-only cryptographic audit log in SQLite (`audit_events`) using SHA-256 hash chaining.
- Build an audit verification CLI (`corepack pnpm run audit:verify`) that recalculates the hash chain from genesis to prove ledger integrity in $O(1)$ memory.
- Provide pluggable logger sinks in `@agent-harness/core/contracts/logging.ts` (console stdout, daily rotating file sinks, and OTel LogRecord exporters).

### Non-goals
- Forcing external APM infrastructure for local development (OpenTelemetry tracing operates with a local no-op or stdout exporter by default).
- Persisting raw LLM prompt text in plain-text audit logs (audit payloads are sanitized for secret and PII containment).
- Runtime plugin code execution auditing (plugins remain statically declared per architecture invariants).

## Required behavior

### 1. OpenTelemetry Distributed Tracing Architecture

#### 1.1 Browser-Safe Tracing Contracts (`@agent-harness/core/contracts/tracing.ts`)
- Pure TypeScript contracts: `ITracer`, `ISpan`, `ITraceContext`, `SpanAttributes`, `SpanKind`, `SpanStatusCode`.
- Zero Node.js or native OpenTelemetry SDK dependencies in `@agent-harness/core`.
- Zero-allocation `NoopTracer` and `NoopSpan` used by default in browser and test environments.
- W3C Trace Context (`traceparent` and `tracestate`) validation, parsing, extraction, and injection.

#### 1.2 Span Hierarchy & Distributed Lifecycle
```text
[HTTP POST /api/chat] (SpanKind: SERVER)
  └── [session.deliver] (SpanKind: INTERNAL)
        ├── [session.mailbox_drain] (SpanKind: INTERNAL, SQLite BEGIN IMMEDIATE)
        └── [agent.run (orchestrator)] (SpanKind: INTERNAL)
              ├── [agent.step 0]
              │     ├── [gen_ai.chat (model: claude-3-7-sonnet)] (SpanKind: CLIENT)
              │     └── [tool.execute: delegate] (SpanKind: INTERNAL)
              │           └── [worker.spawn (task: task-101)] (SpanLink to worker.run)
              └── ...
[worker.run (task: task-101)] (SpanKind: INTERNAL, SpanLink to parent delegate)
  └── [agent.run (worker-task-101)]
        ├── [gen_ai.chat (model: qwen3.7-plus)] (SpanKind: CLIENT)
        └── [tool.execute: readFile] (SpanKind: INTERNAL)
[session.deliver (wake_run)] (SpanKind: INTERNAL, SpanLink to worker completion)
  └── [agent.run (report to user)]
```

#### 1.3 GenAI & Harness Semantic Conventions
- `gen_ai.system`: Provider/protocol (`"anthropic"`, `"openai"`, `"vercel-ai"`).
- `gen_ai.request.model` & `gen_ai.response.model`: Model identifier.
- `gen_ai.usage.input_tokens`, `gen_ai.usage.output_tokens`, `gen_ai.usage.total_tokens`.
- `agent.session_id`, `agent.run_id`, `agent.name`, `agent.step_index`.
- `agent.tool.name`, `agent.tool.arguments` (sanitized & capped at 1,024 chars), `agent.tool.duration_ms`.
- `agent.task_id`, `agent.parent_session_id`, `agent.worker_session_id`.

---

### 2. Prometheus / OpenMetrics Telemetry (`GET /api/metrics`)

Exposed at `GET /api/metrics` supporting `text/plain; version=0.0.4` and `application/openmetrics-text; version=1.0.0`:

| Metric Name | Type | Description | Labels | Buckets |
|---|---|---|---|---|
| `agent_harness_tokens_total` | Counter | Total tokens processed by provider LLMs. | `agent`, `model`, `type="prompt\|completion\|cached"` | N/A |
| `agent_harness_llm_duration_seconds` | Histogram | Latency of provider LLM chat completions. | `agent`, `model`, `status="success\|error"` | `[0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30]` |
| `agent_harness_ttft_seconds` | Histogram | Time-to-first-token in streaming LLM completions. | `agent`, `model` | `[0.05, 0.1, 0.25, 0.5, 1, 2]` |
| `agent_harness_tool_duration_seconds` | Histogram | Duration of tool executions. | `tool`, `status="success\|error"` | `[0.01, 0.05, 0.1, 0.5, 1, 5, 10, 30]` |
| `agent_harness_concurrency_active_runs` | Gauge | Number of actively running agent executions. | None | N/A |
| `agent_harness_concurrency_queue_depth` | Gauge | Number of executions waiting for limiter capacity. | None | N/A |
| `agent_harness_mailbox_events_total` | Counter | Total worker mailbox completion events processed. | `status="acknowledged\|abandoned\|rejected"` | N/A |
| `agent_harness_sessions` | Gauge | Total sessions count. | `state="loaded\|persisted"` | N/A |

#### Cardinality Protection
Dynamic labels (`agent`, `model`, `tool`) are strictly sanitized:
- Agent names are capped at 64 characters and stripped of path characters.
- Model IDs are sanitized to base names without query parameters.
- Label lengths are bounded at 128 characters to prevent TSDB metric explosion.

---

### 3. Tamper-Evident Cryptographic Audit Ledger

#### 3.1 Relational Schema (`audit_events`)
```sql
CREATE TABLE IF NOT EXISTS audit_events (
  seq_id INTEGER PRIMARY KEY AUTOINCREMENT,
  prev_hash TEXT NOT NULL,
  current_hash TEXT NOT NULL,
  timestamp INTEGER NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('user', 'agent', 'system')),
  actor_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  payload TEXT NOT NULL,
  signature TEXT,
  CONSTRAINT chk_audit_seq_id_positive CHECK (seq_id > 0),
  CONSTRAINT chk_audit_prev_hash_len CHECK (length(prev_hash) = 64),
  CONSTRAINT chk_audit_current_hash_len CHECK (length(current_hash) = 64)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_audit_events_current_hash ON audit_events(current_hash);
CREATE INDEX IF NOT EXISTS idx_audit_events_action_ts ON audit_events(action, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_resource ON audit_events(resource_type, resource_id, timestamp DESC);
CREATE INDEX IF NOT EXISTS idx_audit_events_timestamp ON audit_events(timestamp DESC);
```

#### 3.2 Action Taxonomy
- **Sessions**: `session.create`, `session.delete`, `session.rename`
- **Agents**: `agent.create`, `agent.update`, `agent.delete`
- **Privileged Tools**: `tool.exec.shell` (`runCommand`), `tool.exec.file_write` (`writeFile`, `editFile`), `tool.exec.file_delete`, `tool.exec.network` (`webFetch`)
- **Settings**: `settings.update`

#### 3.3 SHA-256 Hash Chaining Algorithm
- **Genesis Block**: `seq_id = 1` links to `prev_hash = "0000000000000000000000000000000000000000000000000000000000000000"`.
- **Canonical Serialization**: `canonicalJsonStringify()` recursively sorts object keys lexicographically and strips whitespace.
- **Secret Redaction Pipeline**: Automatically redacts API keys (`sk-...`, Bearer tokens, private keys) and caps payloads at 64 KB with SHA-256 overflow references.
- **Hash Preimage**:
  $$\text{Preimage}_N = \text{prev\_hash} \parallel \text{"|"}\parallel \text{timestamp} \parallel \text{"|"}\parallel \text{actor\_type} \parallel \text{"|"}\parallel \text{actor\_id} \parallel \text{"|"}\parallel \text{action} \parallel \text{"|"}\parallel \text{resource\_type} \parallel \text{"|"}\parallel \text{resource\_id} \parallel \text{"|"}\parallel \text{canonical\_payload}$$
  $$\text{current\_hash}_N = \text{SHA-256}(\text{Preimage}_N)$$

---

### 4. Verification CLI (`corepack pnpm run audit:verify`)

- Streams records in chunks of 1,000 from `seq_id = 1` to `MAX(seq_id)` with $O(1)$ memory consumption.
- Verifies:
  1. Monotonic sequence continuity ($seq_k = seq_{k-1} + 1$).
  2. Genesis block hash linkage.
  3. Parent hash equality ($prev\_hash_k = current\_hash_{k-1}$).
  4. Recalculated SHA-256 hash equality with stored `current_hash`.
  5. Timestamp sanity ($timestamp_k \ge timestamp_{k-1}$).
  6. Canonical payload structure.
- Returns Exit Code `0` on verified integrity; Exit Code `1` with exact mutated record and field on tampering.

## Acceptance criteria

1. **OTel Context Propagation**: W3C `traceparent` headers received on `/api/chat` propagate through `SessionRuntime`, background workers, and tool spans.
2. **Prometheus Scraping**: Standard Prometheus scraper consumes `GET /api/metrics` with valid counters, gauges, and histograms.
3. **Audit Immutability**: Any direct modification to `payload` or deletion of a row in `audit_events` is immediately detected and flagged by `corepack pnpm run audit:verify`.
4. **Zero Browser Pollution**: Contracts package remains 100% free of Node.js-only tracing or crypto dependencies.
5. **Quality & Performance**: Sub-500ns overhead for metric operations; zero lock contention on audit appends using SQLite `IMMEDIATE` transactions.

## Open questions and decisions

- Governing ADR: `docs/decisions/0005-tamper-evident-audit-and-opentelemetry-observability.md`.
- Export sinks: Default to in-memory Prometheus scraper and stdout trace logging; allow standard OTLP HTTP trace exports via `OTEL_EXPORTER_OTLP_ENDPOINT`.
