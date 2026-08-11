---
summary: Add explicit non-mutating repository checks and opt-in lightweight hooks.
read_when:
  - Changing repository validation commands or developer hooks.
---

# T08 — Add standard verification and cheap hooks

## Goal

Make completion claims machine-checkable without surprise expensive local work.

## Prerequisites

Complete T07. Reuse T02/T04 validation commands.

## Deliverables

Add `npm run check`, `npm run hooks:install`, plus source-controlled `hooks/pre-commit` and `hooks/pre-push`. Pre-commit runs skills validation, docs validation, and `git diff --check`; pre-push runs typecheck and tests. Check should include the standard non-mutating verification suite and never require API keys.

## Acceptance evidence

Verify hook installation is explicit and safe on the intended platform; run `npm run check`; confirm it does not mutate tracked source.

## Handoff

Commit suggestion: `chore: add deterministic repository checks`. Next: [T09](T09-architecture-backlog.md).
