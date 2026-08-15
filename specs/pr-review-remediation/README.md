---
summary: Define the corrective behavior required by the comprehensive review of the agent-ready bootstrap pull request.
read_when:
  - Implementing or reviewing PR review remediations across runtime, persistence, security, server, or dashboard boundaries.
---

# Pull-request review remediation specification

Status: Completed and verified 2026-08-15

## Problem and evidence

The agent-ready bootstrap branch establishes stronger validation, security, and resource-budget claims, but review reproductions found gaps where configured limits are not enforced, provider transcripts can become structurally invalid, real external data is parsed with the wrong shape, security checks can be bypassed, durable corruption has no repair path, and server/dashboard contracts disagree. Several older product paths touched by the branch also remain deterministically broken.

The verified evidence is the source at PR head `d4bcbf85253d45c8a2cf2c1c6359618c037b0f6f`, focused local reproductions, and the findings recorded in the PR review conversation. Governing constraints are [ADR 0002](../../docs/decisions/0002-boundary-validation-and-quality-gates.md), the [quality-hardening specification](../quality-hardening/README.md), [current architecture](../../docs/architecture/CURRENT_STATE.md), and the [security boundary](../../docs/SECURITY.md).

## Goals and non-goals

### Goals

- Make provider, tool, queue, and client-disconnect cancellation observable and bounded.
- Preserve a structurally valid provider transcript when any budget stops a run.
- Parse the current models.dev provider/model hierarchy.
- Close outbound-fetch DNS rebinding and plugin navigation/state bypasses.
- Preserve invalid durable bytes while allowing healthy records to remain usable and explicit repair writes to proceed.
- Align HTTP request and response budgets with semantic schemas without accepting unbounded collections.
- Make agent CRUD, settings, chat chunking, TTS, timestamps, title clearing, and path containment match their public contracts.
- Make hooks and dependency-audit exceptions deterministic and narrowly scoped.

### Non-goals

- Multi-process persistence locking, crash-restartable workers, or mailbox acknowledgement redesign.
- Live provider-token streaming, arbitrary plugin code loading, or capability-registry integration into `Agent.run()`.
- Dependency upgrades or a new regex/network package.
- Silently rewriting invalid transcripts or deleting corrupt durable state.

## Required behavior

### Runtime cancellation and budgets

- `LLMClient` cancellation reaches the pinned AI SDK option.
- Tool execution receives a framework-neutral execution context containing an `AbortSignal`; built-in long-running tools honor it where practical.
- The execution limiter removes aborted waiters, does not consume capacity for canceled work, and admits lifecycle state only after capacity exists.
- Chat client disconnects abort their in-flight run.
- A budget stop after an assistant tool-call response appends one synthetic tool result per unexecuted call before returning.

### Security and external contracts

- `webFetch` connects to an IP address returned by the validation lookup while preserving the original HTTP Host and TLS server name; every redirect is independently resolved and pinned.
- Regex search executes within a deterministic CPU deadline outside the main application context.
- Plugin navigation resolves to a same-origin path and rejects backslashes, control characters, and network-path references.
- Plugin enabled state has no prototype-bearing key lookup.
- models.dev data is parsed as providers containing model maps and lookup supports direct provider/model, model, and correlated identifiers.

### Persistence and API compatibility

- Session collection listing uses the derived metadata index rather than serializing every transcript.
- An invalid transcript remains on disk, does not hide valid sessions, and is returned as a safe diagnostic without exposing absolute paths or contents.
- Invalid open-session or settings bytes remain in a timestamped quarantine copy when an explicit valid update repairs the primary file.
- `ROOT` is environment/discovery-owned and read-only in the settings UI/API; persisted legacy `ROOT` values are accepted and ignored for compatibility.
- Inbox JSON parsing allows the maximum valid escaped file payload only on inbox routes. Individual session responses account for both transcript and mailbox ceilings.
- Agent create/update validates the complete next markdown document before an atomic write; empty tool lists are consistently supported.

### Adapter and tooling correctness

- Chat summary chunking preserves every character, TTS uses the configured API base, persona affects narration, and errors after binary headers do not attempt a second JSON response.
- Completion timestamps are captured at completion, clearing a server title clears the browser projection, and in-root names beginning with two dots remain valid.
- Declared-oversize response bodies are canceled before rejection.
- Pre-commit mutation completes before read-only checks, and audit exceptions match an advisory plus affected package rather than every future advisory for that package.

## Acceptance criteria

1. Every deterministic review reproduction has a focused regression test that fails before its corresponding production edit and passes afterward.
2. Invalid durable files are byte-preserved and surfaced; healthy records and repair operations remain usable.
3. Core remains free of Express, Socket.IO, Next.js, and React dependencies; dashboard remains a validated adapter.
4. No new runtime dependency or compiler-policy exception is introduced.
5. Focused package tests/typechecks, the root credential-free check, coverage, production audit, docs/skills validation, builds, and `git diff --check` pass.

## Open questions and decisions

- **Decision:** use Node's built-in HTTP(S) client with a pinned lookup callback rather than adding an Undici dependency.
- **Decision:** preserve invalid large transcripts in place and expose diagnostics; quarantine only small state files when a deliberate repair would otherwise overwrite them.
- **Decision:** keep `/api/sessions/meta` as an alias while changing the collection endpoint to metadata-only; full transcripts remain addressable by ID.
- **Decision:** `ROOT` cannot bootstrap itself from a file located beneath that same root, so it remains environment/discovery-owned.
- **Decision:** no new ADR is required because these choices implement existing validation, persistence, transcript, extension, and explicit-limit invariants rather than revising them.
