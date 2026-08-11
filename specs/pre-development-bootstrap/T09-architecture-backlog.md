---
summary: Document verified current architecture, desired runtime direction, ontology, and the first runtime design backlog.
read_when:
  - Planning runtime identity, delegation, persistence, or other cross-cutting architecture work.
---

# T09 — Document current architecture and next runtime phase

## Goal

Allow the first runtime-design session to begin from evidence while making no runtime code change.

## Prerequisites

Complete T08. Inspect source directly and use an independent read-only reviewer where available.

## Deliverables

Create `docs/architecture/CURRENT_STATE.md`, `TARGET_DIRECTION.md`, `RUNTIME_ONTOLOGY.md`, and `docs/roadmap/NEXT_RUNTIME_PHASE.md`.

Current state must point to actual files/symbols and distinguish implemented behavior from intent. Target direction records principles only. Runtime ontology separates persistent identity, conversation, task, and execution-run concepts without authorizing an incidental refactor. The roadmap defines an ordered, testable first design phase.

## Boundaries

Do not implement the backlog or present future concepts as current behavior.

## Handoff

Commit suggestion: `docs: map current runtime and next architecture phase`. Next: [T10](T10-dogfood-review.md).
