---
summary: Makes provider routing, health, rate admission, and live reconfiguration server-owned runtime state.
read_when:
  - Changing provider routing, fallback, circuit breaking, rate limits, or settings reload behavior.
  - Adding a model-provider protocol adapter.
---

# ADR 0006: Server-owned provider runtime

Status: Accepted
Date: 2026-08-24

## Context

Provider entries are durable server settings, but each loaded session previously captured its own registry and circuit state. Saving settings reset the configuration cache without replacing loaded clients, so existing sessions continued using stale endpoints and credentials. Declared request/token limits were not enforced, and model discovery assumed the OpenAI response and authentication shape even for Anthropic providers.

## Decision

The server owns one in-memory provider runtime state for the active configuration generation. It contains the immutable registry snapshot plus process-wide, per-provider circuit and fixed-window rate-admission state. Every loaded session client shares that state.

Configured model IDs are opaque and are sent unchanged, including IDs containing `/`. Only the synthetic legacy `opencode-go` provider applies its documented compatibility prefix translation. Protocol-specific discovery normalizes OpenAI and Anthropic model lists into the public settings response without returning credentials or upstream response bodies.

A provider attempt reserves one request and a conservative input-plus-maximum-output token estimate before network I/O. Exceeding either configured minute budget rejects that attempt locally as a transient rate limit, allowing another eligible provider but never creating an unbounded queue. Actual usage cannot safely undo a prior admission reservation.

After a valid settings snapshot is atomically persisted, the server aborts active parent and worker controllers, unloads all loaded sessions, discards provider health/rate state, and lazily constructs a new generation. Durable transcripts, mailbox events, and task terminal handling remain authoritative; no loaded runtime silently retains stale clients.

## Alternatives considered

- Mutating clients in place was rejected because runs could mix endpoints and policies within one execution.
- Per-session circuit and rate state was rejected because it cannot enforce provider-wide configured limits.
- Sleeping until a minute window opens was rejected because it creates an unbounded latency/queue surface.
- Treating every provider as OpenAI-compatible was rejected because Anthropic authentication and model metadata differ.

## Consequences

Settings changes intentionally cancel in-flight work and require the next delivery to create a fresh runtime. Rate counters and circuits are process-local and reset on restart or accepted reconfiguration. Fixed-window admission is conservative and may underutilize a provider, but configured limits are explicit and bounded.
