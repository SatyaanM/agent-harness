---
name: design-before-change
description: Define a bounded technical design before implementation. Use for ambiguous, cross-package, persistence-sensitive, or architectural changes where requirements, current behavior, options, invariants, and acceptance criteria must be resolved before writing code. Do not use when an approved design already exists and only task sequencing is needed.
---

# Design Before Change

## Establish the problem

1. Read the applicable `AGENTS.md` files and discover relevant docs with `corepack pnpm run docs:list`.
2. Trace the current behavior through source and tests. Separate verified behavior from documentation intent.
3. State the user-visible problem, constraints, non-goals, and unknowns. Ask only for choices that materially change the design.

## Evaluate the design

1. Identify affected package boundaries, durable state, APIs/events, extension points, and failure modes.
2. Preserve established invariants unless the change explicitly revises them through an ADR.
3. Compare the smallest credible options. Record tradeoffs and reject unnecessary new abstractions or dependencies.
4. Choose a design with testable acceptance criteria, migration/compatibility handling, and rollback considerations where relevant.

## Hand off

Update or create a focused spec for substantial work. Cite actual files and symbols, label open questions, and stop before implementation unless the request includes it. Use `implementation-planning` once the design is decided.
