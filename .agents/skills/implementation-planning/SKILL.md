---
name: implementation-planning
description: Convert decided requirements or an approved design into an executable, dependency-ordered implementation plan. Use when scope and architecture are sufficiently settled but work must be split into reviewable tasks with exact files, tests, verification, and handoffs. Do not use to resolve an unclear product or architecture design.
---

# Implementation Planning

## Build the plan from evidence

1. Read the governing spec/ADR, applicable `AGENTS.md`, and the source and tests that own the behavior.
2. Confirm prerequisites and current repository state. Mark assumptions instead of presenting them as facts.
3. Decompose work along real dependencies and ownership boundaries, keeping tightly coupled edits together.

## Make each task executable

For every task, record:

- objective and observable acceptance criteria;
- exact files or symbols likely to change;
- behavior and tests to add or update;
- dependencies, non-goals, risks, and migration concerns;
- focused checks plus the proportional root verification;
- expected documentation or decision updates and a concise handoff.

Prefer vertical, reviewable increments that leave the tree coherent. Put research or design decisions before implementation tasks and cleanup after behavior is proven. Avoid vague tasks such as "finish backend" or speculative file lists unsupported by inspection.

## Review the sequence

Check that the plan preserves package and persistence invariants, covers failure paths, introduces no hidden product scope, and ends with independent verification. Update later tasks when earlier work changes the evidence.
