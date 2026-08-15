---
summary: Define the final corrective behavior required to make pull request 1 safe to merge.
read_when:
  - Implementing or reviewing the final pull-request hardening pass.
  - Changing mailbox acknowledgement, session lifecycle, provider transcripts, plugins, or dashboard projections.
---

# Final pull-request hardening specification

Status: Implemented and verified 2026-08-15

## Problem and evidence

The agent-ready bootstrap pull request passes its existing quality suite, but a second comprehensive review found cross-layer defects that the suite does not exercise. Confirmed failures include an unusable agent editor, non-idempotent mailbox consumption, transcript order divergence, lost partial parent and worker transcripts, detached persistence failures, loaded runtimes surviving closure or deletion, an unconsumed process-local worker-result queue, provider finish/reasoning contract errors, active HTML execution, invalid open-session projections, and several unbounded or misleading dashboard paths.

The implementation baseline is PR head `f0e57aa28e001e0e85c965388ef62178ff61bf84`. Governing constraints are [architecture decisions](../../docs/ARCHITECTURE_DECISIONS.md), [delegate behavior](../../docs/DELEGATE_FEATURE_SPEC.md), [current architecture](../../docs/architecture/CURRENT_STATE.md), [target direction](../../docs/architecture/TARGET_DIRECTION.md), and [security](../../docs/SECURITY.md).

## Goals and non-goals

### Goals

- Make worker completion delivery lossless and idempotent across process failure between transcript and mailbox writes.
- Persist the exact canonical message order seen by the model and retain partial parent and worker audit records on failure or cancellation.
- Give closing, deletion, worker cancellation, and detached persistence one server-owned lifecycle with terminal cleanup.
- Make provider messages, finish reasons, reasoning, capability overrides, and search/network limits truthful at their owning boundaries.
- Make plugin state recoverable, identities deterministic, lifecycle middleware effective, and artifact rendering non-executable by default.
- Align dashboard editors, hydration, voice, polling, transient stores, and renderers with their server contracts.
- Add focused automated tests for every deterministic correction and leave current-state documentation evidence-backed.

### Non-goals

- Crash-restartable worker execution, multi-process file locking, a database migration, or a new runtime ontology.
- Arbitrary plugin code loading, runtime product skills, live provider-token streaming, or capability enforcement inside `Agent.run()`.
- Persisting provider secrets from the browser; secrets remain environment-owned.
- Dependency upgrades unless an existing declared dependency is insufficient for a required behavior.

## Required behavior

### Persistence, delivery, and lifecycle

- Mailbox delivery uses `peek -> transcript materialization -> acknowledgement`. A completion remains in the mailbox until a transcript message with the same task identity is durable.
- Recovery after transcript materialization but before acknowledgement does not duplicate a completion. Messages appended during acknowledgement remain ordered and untouched.
- The durable transcript and the model input use one canonical sequence: prior history, newly materialized system deliveries, then the optional user prompt.
- The latest emitted parent and worker messages are persisted on provider failure, cancellation, or later persistence failure; a final empty result never overwrites a richer progressive snapshot.
- Every detached worker path handles rejection and invokes terminal cleanup. The live delegation path does not also retain the result in the legacy process-local message bus.
- Closing unloads the runtime but permits workers to finish into the durable mailbox. Deletion marks the parent unavailable, unloads it, cancels its workers, and prevents late completion from recreating durable state.
- Transcript durability precedes derived-index mutation.

### Contracts, extensions, and security

- Message schemas discriminate by role, tool messages require `toolCallId`, only assistant messages carry reasoning/tool calls, and finish reason/tool-call combinations are coherent.
- Provider truncation, filtering, error, and other non-stop outcomes are not reported as successful completion. Reasoning is stored separately and never copied into ordinary answer content.
- Manual capability overrides include `chat`; grep counts visited files before filtering; web-fetch timeout covers resolution and every abandoned response body is canceled.
- Before-close and before-delete middleware run and can veto before durable mutation.
- Invalid plugin enabled-state bytes remain diagnosable and are quarantined only by an explicit repair update. Duplicate plugin names and command IDs resolve deterministically with plugin-qualified identities.
- HTML artifacts execute no script and cannot load arbitrary network resources; Markdown previews do not perform implicit remote fetches.

### Dashboard and adapter behavior

- Agent source editing is a validated full-document round trip owned by the server. Valid YAML/frontmatter, empty arrays, descriptions, comments, and removal of optional fields work without client regex parsing.
- Open-session state is unique and internally consistent. Hydration chooses an active session only from successfully restored records and repairs the server projection.
- Voice settings accurately state that keys are server environment configuration. Replaced/stopped playback aborts stale requests, chat handles playback rejection, and client disconnect aborts upstream TTS work.
- Worker polling stops at terminal status, cannot apply stale responses, and clears loading state on failure.
- Tool activity and worker roster projections have explicit per-session bounds.
- CSV quoted multiline fields and duplicate headers render correctly; fallback source rendering derives highlighting from the item extension.
- Inbox metadata mutations roll back in-memory state when durable persistence fails.

## Acceptance criteria

1. Each deterministic review reproduction has a focused regression test that is red before its production correction and green afterward.
2. Mailbox fault-injection tests cover failure before materialization, failure after materialization/before acknowledgement, duplicate recovery, and concurrent append preservation.
3. Closing and deletion tests cover loaded runtimes, running workers, late completions, cleanup, and non-resurrection.
4. Provider and durable-message tests reject invalid role/finish combinations and preserve partial audit records.
5. Browser tests cover agent full-source save, restored-active repair, bounded activity, terminal polling, safe renderers, CSV, and voice cancellation behavior.
6. No new package-boundary violation, secret persistence, runtime dependency, weakened schema, or quality-policy exception is introduced.
7. Focused tests, package typechecks, `corepack npm run check`, coverage, production audit, docs/skills validation, build, and `git diff --check` pass from the final tree.

## Open questions and decisions

- **Decision:** mailbox acknowledgement occurs after durable transcript materialization, not after a successful wake-run response. The transcript is the durable delivery acknowledgement; provider failure cannot erase delivery.
- **Decision:** task ID is the compatibility idempotency key for existing worker completions. A schema-versioned delivery-event ID remains future ontology work.
- **Decision:** closing unloads but does not cancel workers; deletion cancels children and prevents late durable resurrection.
- **Decision:** remove the unused exported polling `Orchestrator` implementation rather than preserve a public path that violates the adopted delivery invariant.
- **Decision:** agent source is parsed and validated on the server; the browser is an editor, not a YAML parser.
- **Decision:** no new ADR is required because these choices implement existing adopted invariants rather than replacing them.
