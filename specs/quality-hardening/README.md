---
summary: Define enforceable TypeScript, validation, testing, security, performance, and cost gates for Agent Harness development.
read_when:
  - Changing repository quality scripts, trust-boundary validation, runtime budgets, security controls, or required tests.
  - Evaluating whether the harness is ready for additional provider or runtime development.
---

# Quality hardening specification

Status: Completed — implementation and adversarial verification finished 2026-08-11

## Problem and evidence

The repository has strict TypeScript, Biome, Lefthook, Vitest, build checks, and durable engineering instructions, but those controls do not yet prove the runtime invariants that matter most. The verified baseline in [`docs/architecture/CURRENT_STATE.md`](../../docs/architecture/CURRENT_STATE.md) records four test files, eight tests, 3.91% statement coverage, and no coverage threshold. HTTP handlers, persisted JSON, dashboard API responses, and provider-specific result fields still contain unchecked casts or ad hoc validation.

The harness executes shell commands, reads and writes files, calls external providers, and persists multi-agent delivery state. A typecheck alone cannot make those boundaries safe, and validation alone cannot replace authorization, containment, or resource limits.

## Goals and non-goals

### Goals

- Keep every TypeScript project in strict mode and prevent local configurations from weakening it.
- Treat values from HTTP, WebSocket, environment, filesystem, persisted state, plugins, providers, subprocesses, and tools as `unknown` until parsed at the owning boundary.
- Preserve transcript fidelity while rejecting or quarantining invalid envelopes and never silently dropping durable mailbox records.
- Make test, coverage, hardening, performance, and cost expectations executable and ratcheted.
- Keep local feedback fast while making protected CI the authoritative gate.
- Default privileged capabilities to the narrowest practical environment, time, byte, path, and concurrency limits.

### Non-goals

- Revalidate values at every internal function call.
- Introduce a second validation library without measured evidence that the pinned Zod implementation is a bottleneck.
- Claim process isolation or a complete security sandbox from application-level validation.
- Require paid provider credentials or live model calls in repository checks.
- Resolve the broader runtime identity, crash-recovery, or provider-registry roadmap in this initiative.

## Required behavior

### Trust boundaries

External values enter as `unknown`, are parsed once, and become trusted typed values only after successful validation. Framework-specific request schemas remain in the server; shared framework-neutral domain schemas may live in core; dashboard responses and events are parsed at the browser boundary.

Schemas must constrain identifiers, collection sizes, numeric ranges, discriminants, URLs, and string sizes where those limits protect correctness or resources. Schema transforms must not rewrite persisted model or tool content.

### Failure semantics

- Invalid client input returns a stable 400 response without internal stack or filesystem details.
- Invalid provider data becomes a typed upstream protocol failure.
- Invalid dashboard responses or events are rejected rather than asserted into state.
- Invalid configuration fails clearly before execution.
- Invalid transcripts or mailbox records are preserved for diagnosis; a mailbox record is never skipped and later erased as though delivered.
- Invalid derived indexes and caches may be discarded and rebuilt from their source of truth.

### Static policy

An executable policy check must inspect resolved TypeScript configurations and source syntax. It rejects weakened strictness, TypeScript suppression directives, unsafe `any` or double assertions, and direct access to selected raw boundary APIs outside approved parsing helpers. Every exception requires a rationale, owner, tracking reference, and expiry.

### Tests and coverage

Behavior changes require focused tests unless an explicit expiring exception exists. Critical persistence, delivery, cancellation, path, request-validation, and resource-budget behavior must include negative and failure-path tests. Coverage begins as a non-regression ratchet and advances to critical-file and changed-line thresholds as those suites are established; a low global percentage is not evidence of protection.

### Performance, cost, and privileged execution

Limits for steps, concurrent executions, delegation, retries, wall time, input/output bytes, and model usage are runtime behavior with deterministic tests. Timing benchmarks are informational locally and blocking only on a stable runner. Shell commands receive a minimal environment and explicit time/output limits. Filesystem and network tools enforce authorization separately from schema validation.

## Acceptance criteria

- Every project resolves with strict TypeScript and the policy test proves a weakened fixture fails.
- Server mutation routes parse params, query, and body through schemas; malformed and oversized inputs have route tests.
- Core persisted session and mailbox records are schema-validated, version-aware where required, and corruption cannot be silently acknowledged or dropped.
- Dashboard API and WebSocket adapters parse untrusted responses before updating stores.
- Tool calls are parsed at execution and privileged tools enforce environment, path, network, time, and byte controls with tests.
- `MAX_CONCURRENT_AGENTS` and run budgets are enforced rather than merely configured.
- Layered fast, full, CI, security, performance, and nightly commands are documented and wired to appropriate hooks or CI.
- Root quality, typecheck, test, build, documentation, skill, coverage, and diff checks pass without modifying tracked source.

## Decisions

- Boundary validation and parsed domain types are governed by [ADR 0002](../../docs/decisions/0002-boundary-validation-and-quality-gates.md).
- Zod remains the default validator. Alternatives require a benchmark, migration cost analysis, and an ADR if they change shared contracts.
- CI configuration is added only after the local scripts it invokes are deterministic.
