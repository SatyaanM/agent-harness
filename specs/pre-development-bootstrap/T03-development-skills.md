---
summary: Add focused repo-local engineering workflow skills without creating product runtime skills.
read_when:
  - Creating or adapting repository development skills.
---

# T03 — Add initial repository-local development skills

## Goal

Provide repeatable workflows for agents that develop this repository.

## Prerequisites

Complete T00–T02. Before adaptation, check current Agent Skills/Codex guidance and source licenses/revisions for patterns borrowed from Superpowers or agent-scripts.

## Deliverables

Create one focused `SKILL.md` under each of these folders:

`design-before-change`, `implementation-planning`, `test-driven-development`, `systematic-debugging`, `verification-before-completion`, `code-review`, `docs-and-decisions`, and `source-cannibalization`.

Use `.agents/skills/` only. Skills describe a workflow, not broad project policy; use progressive disclosure for large references. Record adaptation provenance as required by T07, or leave precise research placeholders to be completed there.

## Acceptance

Every description has a distinct trigger; no two skills substantially compete; no skill presumes product support for runtime skills; no root `skills/` directory exists.

## Handoff

Commit suggestion: `feat(dev): add repository engineering skills`. Next: [T04](T04-skill-validation.md).
