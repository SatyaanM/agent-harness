---
summary: Adopt structured, correlated logging and a stable error envelope for Agent Harness.
read_when:
  - Adding logging, error reporting, WebSocket events, or observability across core, server, or dashboard.
---

# ADR 0003: Standardize runtime correlation, structured logging, and error envelopes

Status: Accepted
Date: 2026-08-16

## Context

Before this decision the repository used 27 ad-hoc `console.*` calls spread across core, server, and dashboard, with no log levels, no structured fields, and no way to tie an HTTP request to the agent run, worker task, WebSocket events, and log lines it produced. Non-HTTP error surfaces (tool failures, worker failures, plugin observers, lifecycle hooks, TTS) each reported errors in their own shape, so a failure could not be categorized or correlated consistently. `TARGET_DIRECTION.md` principles #1 and #2 already flag the missing run/execution identity, and the browser-safe `core/contracts` surface already constrains what core, server, and dashboard may share.

## Decision

1. **One dependency-free structured logger** lives in `core/contracts` (browser-safe). It is namespaced, leveled (`debug`/`info`/`warn`/`error`, default threshold `info`), takes structured fields, exposes `child(fields)` to attach stable correlation context, and accepts an injectable sink (default: one greppable line per record on the console). Core, server, and dashboard all use this single implementation.

2. **Correlation identity is ephemeral, not persisted.** `SessionRuntime.runOnce` generates a fresh `runId` (UUID) per execution attempt, and the HTTP edge (chat route) generates an optional `requestId`. Both are threaded into logs via child loggers and into WebSocket agent-lifecycle events (`agent:started`/`agent:completed`/`agent:error`/`agent:tool`). `runId` is deliberately not written to transcripts; durable run identity and its schema/migration implications remain a separate identity/persistence decision (ADR not yet written).

3. **A stable error envelope** normalizes any thrown value via `describeError(unknown) -> { name, code, message }`, where `code` is a Node-style `code` when present and otherwise the error class name. It is applied at tool failures, worker failures, plugin observers, hooks, TTS, and the server error middleware, and surfaced as a `code` field on `agent:error` WebSocket events. The existing HTTP error envelope (`invalid_json`, `request_too_large`, `internal_error`) is unchanged.

4. **All ad-hoc `console.*` calls in production source are migrated** to the logger. `console.*` remains only inside the logger's own default sink.

## Alternatives considered

- **Adopt OpenTelemetry/distributed tracing now.** Rejected as a premature platform build: it contradicts "grow through tested vertical slices" and would add a tracing dependency before the correlation primitive existed. Threading `runId` now makes tracing a drop-in later.
- **Persist `runId` in transcripts.** Rejected for this slice: it is a durable-schema change requiring migration rules (`TARGET_DIRECTION.md` principle #9) and belongs with the broader identity/recovery design.
- **Use an external logging library (pino/winston).** Rejected: a minimal facade is sufficient and must stay browser-safe for the shared `contracts` surface.
- **Thread correlation via `AsyncLocalStorage`.** Rejected: Node-only and incompatible with the browser-safe contracts surface; explicit parameter threading is simpler, portable, and testable.

## Consequences

- A full run is now traceable across the HTTP edge, runtime, workers, and WebSocket events via `requestId`/`runId`, and logs are structured and greppable.
- No persistence schema changed, so no migration or compatibility burden is introduced.
- Logging remains process stdout; no log aggregation, sink, or retention decision is made here.
- Metrics/histograms, distributed tracing, and an administrative audit trail remain out of scope. An audit trail still requires an authenticated actor, which does not exist (loopback-only deployment).
- Dashboard WebSocket agent-lifecycle schemas are passthrough, so the added `runId`/`requestId`/`code` fields are additive and backward-compatible.

## Evidence and supersession

Implemented by `core/contracts/logging.ts`, `core/contracts/errors.ts`, the `runId`/`requestId` threading in `core/agent/session-runtime.ts`, the `requestId` generation in `server/routes/chat.ts`, the correlation fields in `server/ws/events.ts`, and the migrated call sites across core, server, and dashboard. Reinforces `TARGET_DIRECTION.md` principles #1 and #2 without superseding any existing ADR.
