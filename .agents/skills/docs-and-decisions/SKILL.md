---
name: docs-and-decisions
description: Create or update durable repository documentation, specifications, plans, handoffs, or architecture decision records after behavior or a design decision changes. Use when knowledge must remain discoverable across sessions or when a cross-cutting choice needs rationale and consequences. Do not use for transient commentary or code comments.
---

# Documentation and Decisions

## Choose the durable artifact

- Update an existing doc when its governed behavior changed.
- Use a spec for requirements and boundaries, a plan/tasks artifact for execution, an ADR for a lasting architectural choice, and a handoff for resumable session state.
- Avoid a new document when one authoritative location already exists.

## Write from evidence

1. Discover current docs with `corepack pnpm run docs:list` and inspect source before describing implementation.
2. Separate current behavior, target direction, decisions, and unresolved questions.
3. For an ADR, record context, decision, alternatives, consequences, status, and supersession links.
4. Add concise `summary` and `read_when` frontmatter to files under `docs/`.
5. Use repository-relative links and avoid personal paths or claims that depend on an unrecorded conversation.

## Verify

Run `corepack pnpm run docs:list`, `corepack pnpm run docs:check`, and `git diff --check`. Check links and ensure directly affected plans or future tasks still reflect the new facts.
