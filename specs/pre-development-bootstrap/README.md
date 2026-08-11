---
summary: Dependency-ordered, session-sized plan for making Agent Harness ready for reliable agent-assisted development.
read_when:
  - Starting or resuming the pre-development bootstrap.
  - Choosing the next sequential Codex task.
---

# Pre-development bootstrap

Status: Completed 2026-08-10

Next design phase: [`docs/roadmap/NEXT_RUNTIME_PHASE.md`](../../docs/roadmap/NEXT_RUNTIME_PHASE.md). The bootstrap added development infrastructure and documentation only; it made no product runtime change.

This directory decomposes the user-authored bootstrap brief into one bounded task per coding session. It deliberately prepares development infrastructure only; it must not add runtime/product features.

Source reviewed: `C:\Users\satyaan\Downloads\AGENT_HARNESS_PRE_DEVELOPMENT_BOOTSTRAP.md` (SHA-256 `2E07721A5EA28F0B88DC57288129BEAAC0D5070F6C9F3CDA63906B0FE2EBB455`, reviewed 2026-08-10).

## Sequence

1. [T00 — baseline](T00-baseline.md)
2. [T01 — instruction hierarchy](T01-instruction-hierarchy.md)
3. [T02 — documentation index](T02-documentation-index.md)
4. [T03 — development skills](T03-development-skills.md)
5. [T04 — skill validation](T04-skill-validation.md)
6. [T05 — Codex specialist configuration](T05-codex-specialists.md)
7. [T06 — principles and planning artifacts](T06-planning-artifacts.md)
8. [T07 — provenance and upstream research](T07-provenance-research.md)
9. [T08 — deterministic verification and hooks](T08-verification-hooks.md)
10. [T09 — current-state architecture and runtime backlog](T09-architecture-backlog.md)
11. [T10 — dogfood and bootstrap review](T10-dogfood-review.md)

Do tasks in order. A session may stop after its assigned task; it should leave a concise handoff in its final report, not begin the next task.

## Global constraints

- Preserve the current package boundary: `core` is pure domain/runtime TypeScript; server and dashboard are adapters.
- Preserve durable delegation/mailbox semantics; agents do not poll for worker completion.
- `.agents/skills/` is for coding agents developing this repository. Do not create the future product/runtime `skills/` directory or loader.
- Do not implement memory, SQLite, scheduler, MCP/A2A, identity refactors, new multi-agent runtime, or other runtime features during this bootstrap.
- Keep third-party adaptations small, traceable, and license-aware.
- Avoid dependency upgrades, unrelated fixes, and mass formatting. Record baseline failures instead.
- Each task must report exact verification commands and results before completion.

## Session completion contract

Each session must: inspect the relevant existing code/docs; keep changes limited to its task; run the listed checks; review its diff; update any directly affected durable docs; and report changed files, verification evidence, remaining risks, and the next plan file.
