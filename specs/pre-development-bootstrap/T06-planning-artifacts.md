---
summary: Establish project principles, lightweight planning templates, and the first development-layer ADR.
read_when:
  - Creating a substantial spec, implementation plan, task list, ADR, or session handoff.
---

# T06 — Establish project principles and planning artifacts

## Goal

Create durable constraints and a proportional planning workflow for future architecture work.

## Prerequisites

Complete T05. Use the original bootstrap brief's principles, planning, and ADR sections as requirements.

## Deliverables

`docs/PROJECT_PRINCIPLES.md`, `PLANS.md`, `specs/README.md`, templates for SPEC/PLAN/TASKS/ADR/HANDOFF under `docs/templates/`, `docs/decisions/README.md`, and `docs/decisions/0001-development-agent-layer.md`.

ADR 0001 must establish the boundary between repo-development `.agents/skills/` and future product/runtime skills. Templates must be short and practical.

## Acceptance

Trivial work is exempt from heavy ceremony; foundational runtime work requires design/spec/plan; all durable docs meet T02 metadata requirements.

## Handoff

Commit suggestion: `docs: establish project principles and planning workflow`. Next: [T07](T07-provenance-research.md).
