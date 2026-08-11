---
summary: Independently verify that the bootstrapped repository guides a new coding-agent session correctly.
read_when:
  - Completing or auditing the pre-development bootstrap.
---

# T10 — Dogfood the bootstrap

## Goal

Prove that repository-owned context, skills, checks, and provenance let a fresh agent plan safely without implementing runtime work.

## Prerequisites

Complete T00–T09.

## Procedure

In a fresh read-only context, ask the agent to explain current architecture; list delegation/persistence invariants; distinguish development skills from future runtime skills; identify docs/skills to read before runtime identity work; produce but do not implement the first ontology-change plan; run non-mutating checks; and review bootstrap consistency. Use independent architecture, test/verification, and docs/provenance reviewers where available.

## Acceptance evidence

The agent discovers context through the repository, selects relevant skills, makes no runtime implementation, passes validation, and reports coherent provenance. Fix only defects in the bootstrap layer, then re-run impacted checks.

## Handoff

Commit suggestion: `chore: finalize agent-ready repository bootstrap`. Defer P1 work (CI, session handoff skill, DEVELOPMENT.md, lint/format audit, runtime spec shell) unless explicitly scheduled next.
