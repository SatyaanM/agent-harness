---
summary: Establish a clean, documented fork baseline before bootstrap changes.
read_when:
  - Beginning the pre-development bootstrap.
---

# T00 — Establish fork/upstream and clean baseline

## Goal

Create a recoverable, evidence-backed starting point without changing product behavior.

## Prerequisites

None. Read the root package scripts and inspect git state first.

## Work

1. Confirm `origin` remains the user's fork; add `damain/agent-harness` as `upstream` if absent and fetch both remotes.
2. Record branch, commit, remotes, Node/npm versions, dependency installation outcome, and clean/dirty worktree state.
3. Create `chore/agent-ready-bootstrap` only if the user authorizes branch creation or it is already the active workflow.
4. Run `npm run typecheck`, `npm test`, and `npm run build` without repairing unrelated failures.
5. Add `docs/BASELINE.md` with exact commands, dates, results, and known environment caveats.

## Boundaries

Do not update dependencies, refactor source, or conceal failures. Do not overwrite an existing dirty worktree.

## Acceptance evidence

- Baseline facts and check results are versioned in `docs/BASELINE.md`.
- No pre-existing changes are lost.
- Any failure is explicitly recorded with enough output to reproduce it.

## Handoff

Commit suggestion: `docs: record fork baseline`. Next session: [T01](T01-instruction-hierarchy.md).
