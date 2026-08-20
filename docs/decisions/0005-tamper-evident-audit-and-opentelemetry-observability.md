---
summary: Adopt OpenTelemetry distributed tracing, Prometheus/OpenMetrics telemetry, and SHA-256 tamper-evident cryptographic audit logs.
read_when:
  - Designing or implementing telemetry, OpenTelemetry spans, Prometheus metrics, or security audit logs.
  - Reviewing observability contracts, performance monitoring, and cryptographic audit verification.
---

# ADR 0005: Tamper-Evident Audit Ledger and OpenTelemetry Observability

Status: Accepted
Date: 2026-08-20

## Context

As Agent Harness evolves to support complex multi-agent workflows, autonomous worker delegations, and security-sensitive tool invocations (such as shell execution, file mutations, and external web fetching):

1. **Opaque Multi-Agent Tracing**: While ephemeral `runId` and `requestId` are logged via ADR 0003, there is no standardized W3C `traceparent` context propagation. Complex execution flows traversing HTTP requests, WebSocket events, subagent worker delegations, LLM provider API calls, and tool invocations cannot be correlated or visualized across APM tools (such as Jaeger, Grafana Tempo, or Datadog).
2. **Missing Granular Performance Metrics**: Telemetry currently lacks standard metrics for token consumption (prompt, completion, cached), Time-To-First-Token (TTFT) histograms, tool execution duration, provider latency, and execution concurrency pool saturation.
3. **Repudiation and Forensic Risk**: Security-critical actions (executing shell commands, writing filesystem files, mutating agent configurations, and deleting sessions) are only recorded as ephemeral console logs or unstructured transcript entries. An administrator or security auditor cannot prove that log records were not deleted, modified, or reordered after an incident.

## Decision

1. **Browser-Safe Tracing Contracts in Core**:
   Define pure, zero-dependency tracing interfaces (`ITracer`, `ISpan`, `ITraceContext`, `SpanAttributes`, `SpanKind`, `SpanStatusCode`) and W3C Trace Context (`traceparent`, `tracestate`) parser/serializer in `@agent-harness/core/contracts/tracing.ts`. Provide a zero-allocation `NoopTracer` for environments without active tracing.

2. **OpenTelemetry SDK Adapter in Server**:
   Implement an OpenTelemetry Node.js SDK adapter (`OTelTracerAdapter`, `OTelSpanAdapter`) in `@agent-harness/server/src/telemetry/tracer.ts`. Context propagates across asynchronous operations via `AsyncLocalStorageContextManager` and across worker delegations via W3C trace carriers and span links.

3. **In-Memory Prometheus / OpenMetrics Registry (`GET /api/metrics`)**:
   Implement a high-throughput, zero-dependency metrics registry in `@agent-harness/server/src/telemetry/metrics.ts` exposing Prometheus text exposition format (v0.0.4) and OpenMetrics (v1.0.0). Enforce strict label cardinality bounding and sanitization.

4. **Tamper-Evident Cryptographic Audit Ledger in SQLite (`audit_events`)**:
   - Introduce an append-only relational table `audit_events` via migration `002_audit_events.sql`.
   - Each audit record is cryptographically linked to its predecessor via SHA-256 hash chaining:
     $$\text{Preimage}_N = \text{prev\_hash} \parallel \text{"|"}\parallel \text{timestamp} \parallel \text{"|"}\parallel \text{actor\_type} \parallel \text{"|"}\parallel \text{actor\_id} \parallel \text{"|"}\parallel \text{action} \parallel \text{"|"}\parallel \text{resource\_type} \parallel \text{"|"}\parallel \text{resource\_id} \parallel \text{"|"}\parallel \text{canonical\_payload}$$
   - Genesis block links to a 64-character null hash (`0000...0000`).
   - Payloads are serialized using deterministic canonical JSON (lexicographically sorted keys, no whitespace) and processed through a secret redaction pipeline (redacting API keys, bearer tokens, passwords) with a 64 KB size bound.
   - All appends execute within SQLite `IMMEDIATE` transactions (`withImmediateTransaction`) to prevent chain forking.

5. **Streaming Audit Verification CLI (`corepack pnpm run audit:verify`)**:
   Implement an $O(1)$-memory verification CLI (`scripts/verify-audit-log.mjs`) that streams `audit_events` from genesis to the latest sequence number, verifying sequence continuity, prev_hash linkage, SHA-256 digest correctness, and payload canonicalization.

## Alternatives considered

- **External Logging & APM Daemons Only (FluentBit / Vector)**: Rejected because Agent Harness is an embeddable, developer-first orchestration application that must provide self-contained auditability, metrics, and tracing out of the box without mandatory third-party infrastructure.
- **Unchained Relational Audit Table**: Rejected because a standard table without cryptographic hash chaining allows an attacker with SQLite database write access to modify or delete historical records without leaving verifiable forensic evidence.
- **Heavyweight External Metrics Client (`prom-client`)**: Rejected in favor of a lean, zero-dependency internal registry adhering strictly to OpenMetrics/Prometheus format, avoiding unnecessary bundle dependencies and memory bloat.

## Consequences

- Full distributed observability across the entire agent lifecycle, worker delegations, LLM provider calls, and tool executions.
- Standardized Prometheus metric scraping at `GET /api/metrics` enables turnkey monitoring via Grafana and Prometheus.
- Non-repudiable audit trails provide mathematical proof of integrity for all security-critical operations.
- Core package remains 100% browser-safe and free of Node.js-only SDKs or native crypto dependencies.

## Evidence and supersession

- Expands on ADR 0003 (Structured Logging and Correlation) and ADR 0004 (ACID Storage and Relational Persistence).
- Fulfills principles #1, #3, #5, and #7 in `docs/architecture/TARGET_DIRECTION.md`.
- Governed by `specs/observability-audit-metrics/SPEC.md` and `specs/observability-audit-metrics/PLAN.md`.
