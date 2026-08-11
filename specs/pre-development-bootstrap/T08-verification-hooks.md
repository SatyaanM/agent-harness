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

## Tooling follow-up (2026-08-11)

The original source-controlled shell hooks were replaced after the bootstrap commit by cross-platform Lefthook configuration in `lefthook.yml`. Dependency installation now migrates the exact legacy `core.hooksPath=hooks` setting and installs Lefthook automatically; unrelated contributor hook paths are preserved. Pre-commit runs staged Biome fixes plus the existing documentation, skill, and whitespace checks. Pre-push runs the full credential-free `corepack npm run check`, which now starts with the Biome quality gate.

Root Vitest project mode remains the canonical test runner. Watch, UI, package-runner, and V8 coverage commands are exposed separately so the fast required check does not write coverage artifacts or start an interactive process.
