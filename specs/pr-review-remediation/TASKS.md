---
summary: Track implementation and acceptance evidence for the comprehensive PR review remediation.
read_when:
  - Selecting, reviewing, or handing off a PR review remediation task.
---

# Pull-request review remediation tasks

- [x] **T01 - Enforce cancellation and valid budget-stop transcripts**
  - Depends on: none
  - Scope: core agent/provider/tool/limiter/session runtime and server chat lifecycle
  - Acceptance: provider, tool, queued, and disconnected runs stop observably; every persisted tool call has a result
  - Verify: focused core agent/limiter/session-runtime and server chat tests
  - Docs/handoff: current-state runtime budgets and cancellation facts
- [x] **T02 - Close external-data and privileged-boundary gaps**
  - Depends on: T01
  - Scope: models.dev, web fetch, grep, plugin contracts/state, bounded HTTP reads
  - Acceptance: real provider hierarchy resolves; DNS/plugin/prototype/regex/body-lifecycle reproductions are blocked
  - Verify: focused core capability/tool/contract and server plugin tests
  - Docs/handoff: security controls and residual risks
- [x] **T03 - Repair durable-state and HTTP contract mismatches**
  - Depends on: T02
  - Scope: session diagnostics/listing, open/settings repair, API limits, inbox parsing, settings root
  - Acceptance: invalid bytes remain diagnosable; valid requests/responses fit transport budgets; collections remain bounded
  - Verify: focused core persistence and server/dashboard API tests
  - Docs/handoff: persistence/API current-state facts
- [x] **T04 - Repair touched product paths**
  - Depends on: T03
  - Scope: agent CRUD, chat chunking, TTS, title synchronization, timestamps, path containment
  - Acceptance: each reported deterministic product defect has a regression test and corrected behavior
  - Verify: focused core/server/dashboard tests and package typechecks
  - Docs/handoff: README configuration and API behavior
- [x] **T05 - Make repository controls deterministic and deliver**
  - Depends on: T01-T04
  - Scope: Lefthook, security exceptions, durable docs, full verification, final diff, commit and push
  - Acceptance: required root checks pass from the final tree and the PR branch is updated
  - Verify: commands in `PLAN.md`; clean status after push
  - Docs/handoff: mark spec/plan/tasks complete with evidence
