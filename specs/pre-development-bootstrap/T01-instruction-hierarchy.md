---
summary: Add concise, accurate repository and package-level instructions for coding agents.
read_when:
  - Adding AGENTS.md files or changing repository development policy.
---

# T01 — Add repository instruction hierarchy

## Goal

Make a fresh coding-agent session able to locate the architecture, respect boundaries, and verify work without a giant prompt.

## Prerequisites

Complete T00. Read README, architecture decisions, delegation spec, and all package scripts/boundaries.

## Deliverables

- `AGENTS.md`
- `packages/core/AGENTS.md`
- `packages/server/AGENTS.md`
- `packages/dashboard/AGENTS.md`

Root policy covers mission, start-here flow, layout, hard invariants, proportional spec/ADR workflow, canonical verification, docs navigation, provenance, and scope discipline. It explicitly distinguishes `.agents/skills/` from reserved future runtime `skills/`.

Package files add only local rules: core stays free of HTTP/UI dependencies; server remains a thin validated transport/host; dashboard uses registry-based extension points and authoritative runtime state.

## Boundaries and acceptance

Keep root instructions concise; do not invent commands or restate large methodologies. Confirm current invariants against source before claiming them. Acceptance is accurate, non-duplicative instructions with explicit verification requirements.

## Handoff

Commit suggestion: `chore: add repository agent instructions`. Next: [T02](T02-documentation-index.md).
