---
summary: Proportional planning policy and completion contract for Agent Harness changes.
read_when:
  - Deciding whether work needs a spec, implementation plan, task breakdown, ADR, or handoff.
  - Writing or reviewing a substantial development plan.
---

# Planning work

Use the lightest durable artifact that makes the work safe and resumable.

## Planning threshold

- **Direct change:** obvious, local, reversible work with no contract, persistence, or architecture impact. State acceptance criteria in the task and proceed.
- **Plan:** multi-file or multi-step work whose design is settled. Record dependency order, exact ownership, tests, and verification.
- **Spec plus plan:** ambiguous behavior, new public contracts, persistence/schema changes, cross-package runtime work, or meaningful compatibility/security risk.
- **ADR:** a lasting architectural decision, rejected credible alternatives, or a change to an adopted invariant.

Do not use planning documents to disguise unresolved product choices. Resolve the design first, then create executable tasks.

## Required qualities

Plans must be evidence-backed, dependency-ordered, bounded, and testable. Each task names its objective, likely files/symbols, acceptance criteria, tests, verification, docs impact, dependencies, and non-goals. Separate current behavior from target direction and update later tasks when earlier evidence changes them.

## Completion contract

Before closing a task: review the final diff, run focused and proportional checks, remove temporary/generated residue, update directly affected durable docs, and leave a handoff containing changed files, exact evidence, remaining risks, and the next task.

Templates live under `docs/templates/`; active work belongs under `specs/`.
