---
summary: Track implementation and verification evidence for the final pull-request hardening pass.
read_when:
  - Selecting or reviewing the next final-hardening task.
---

# Final pull-request hardening tasks

- [x] **T01 - Make delivery and transcripts lossless and faithful**
  - Depends on: none
  - Scope: `SessionStore`, `SessionRuntime`, `Worker`, delegation, legacy orchestration surface
  - Acceptance: idempotent materialize/ack delivery, canonical order, partial failure persistence, terminal cleanup, no live bus retention
  - Verify: focused core persistence/runtime/delegation tests
  - Docs/handoff: mailbox and audit facts in current-state/delegate docs
- [x] **T02 - Make session lifecycle server-owned**
  - Depends on: T01
  - Scope: `SessionManager`, session routes, open-session state, lifecycle hooks
  - Acceptance: close unloads, delete cancels/prevents resurrection, before hooks veto, state invariants hold
  - Verify: focused server manager/route tests
  - Docs/handoff: lifecycle/current-state facts
- [x] **T03 - Tighten provider, persistence, and tool boundaries**
  - Depends on: T01
  - Scope: message/LLM schemas, Vercel adapter, capability registry, index, inbox, grep, web fetch
  - Acceptance: truthful outcomes, valid transcripts, committed derived state, bounded/cancelable tools
  - Verify: focused core contract/provider/tool/persistence tests
  - Docs/handoff: security/current-state facts
- [x] **T04 - Harden plugins and artifact rendering**
  - Depends on: T02
  - Scope: plugin registry/store/commands, HTML/Markdown renderers
  - Acceptance: recoverable state, deterministic identities, no active or implicit-network artifact content
  - Verify: focused server/dashboard tests
  - Docs/handoff: plugin/security facts
- [x] **T05 - Repair dashboard and adapter contracts**
  - Depends on: T02-T03
  - Scope: agent editor/routes/API, hydration, voice/TTS, polling, bounded stores, CSV/text renderers
  - Acceptance: full-source agent edits, consistent restored state, truthful/cancelable voice, terminal/bounded projections, correct rendering
  - Verify: focused server/dashboard tests and typechecks
  - Docs/handoff: README/current-state behavior
- [x] **T06 - Verify, re-review, commit, and push**
  - Depends on: T01-T05
  - Scope: final docs, complete diff, all required checks, GitHub PR branch
  - Acceptance: no remaining material review findings; required checks pass from final tree; branch pushed
  - Verify: commands in `PLAN.md` plus live PR checks
  - Docs/handoff: completion evidence and remaining accepted risks
