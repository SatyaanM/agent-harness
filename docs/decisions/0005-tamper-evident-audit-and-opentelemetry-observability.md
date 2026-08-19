---
summary: Adopt tamper-evident cryptographic audit logs, OpenTelemetry distributed tracing, and Prometheus metrics.
read_when:
  - Adding metrics, distributed tracing, OpenTelemetry spans, or audit logs across Agent Harness.
  - Designing security governance, compliance verification, and execution timing telemetry.
---

# ADR 0005: Tamper-evident audit logs, OpenTelemetry tracing, and Prometheus metrics

Status: Proposed
Date: 2026-08-18

## Context

ADR 0003 standardized runtime correlation (`runId`, `requestId`), browser-safe structured logging, and stable error envelopes. However, as Agent Harness scales into multi-agent collaboration, production deployments, and autonomous execution:
1. **Tracing across boundaries is opaque**: While `runId` and `requestId` exist, there is no standardized W3C `traceparent` context propagation across HTTP requests, WebSocket frames, subagent task delegations, provider LLM API invocations, and tool executions.
2. **Telemetry lacks APM standards**: Standard performance metrics (TTFT, token counters, tool duration histograms, queue saturation) are not exposed in standard OpenMetrics/Prometheus formats.
3. **Audit trails lack non-repudiation**: Security-sensitive operations (modifying agent prompts, executing terminal shell commands, altering filesystem files, deleting sessions) are only recorded as transient log lines without tamper-evident cryptographic proofs.

## Decision

1. **Adopt OpenTelemetry (OTel) Distributed Tracing**:
   - Propagate standard W3C `traceparent` headers through the HTTP ingress, WebSocket frames, and worker execution threads.
   - Emit hierarchical OTel spans: `[HTTP Request] ➔ [SessionRuntime.deliver] ➔ [Agent.run] ➔ [LLM.generate] + [Tool.execute]`.
   - Maintain browser-safe contracts by keeping OTel tracer interfaces abstract in `@agent-harness/core/contracts` and injecting concrete Node.js OTel SDK exporters in `@agent-harness/server`.
2. **Export OpenMetrics / Prometheus Telemetry at `/api/metrics`**:
   - Monotonic token counters partitioned by model, agent, and token type (`prompt`, `completion`, `cached`).
   - Latency histograms for Time-To-First-Token (TTFT) and full turn completion.
   - Tool execution timing histograms partitioned by tool name.
   - Gauges for active execution slots and queue backlog depth.
3. **Implement Tamper-Evident Hash-Chained Audit Trails**:
   - Persist an append-only `audit_events` ledger in SQLite where each record contains:
     `current_hash = SHA256(prev_hash + timestamp + actor_type + actor_id + action + resource_type + resource_id + payload)`
   - Record explicit actor attribution (`user`, `agent`, `worker`, `system`).
   - Provide a verification script (`corepack npm run audit:verify`) that recalculates the Merkle hash chain from the genesis block to detect unauthorized modifications.
4. **Support Pluggable Logging Sinks**:
   - Extend `@agent-harness/core/contracts/logging.ts` to support multi-sink dispatch (console stdout, daily rotating log files under `.harness/logs/`, and OTel LogRecord exporter).

## Alternatives considered

- **Ad-hoc JSON audit files**: Rejected because flat log files can be modified or truncated without detection.
- **Proprietary analytics/tracing SDKs (DataDog/NewRelic direct SDKs)**: Rejected because vendor-neutral OpenTelemetry allows users to route traces to any OTLP collector (Jaeger, Zipkin, Datadog, Prometheus) without codebase coupling.

## Consequences

- Full observability into latency bottlenecks and token consumption across complex multi-agent delegation chains.
- Compliance and forensic readiness through cryptographically verifiable audit logs.
- Standard Prometheus scraping compatibility for production deployments.
- Minimal runtime overhead via lightweight OpenTelemetry sampling and SQLite WAL appends.

## Evidence and supersession

Builds upon ADR 0003 and satisfies principles #2, #5, and #7 in `docs/architecture/TARGET_DIRECTION.md`.
