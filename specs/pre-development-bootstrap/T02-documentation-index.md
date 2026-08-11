---
summary: Implement metadata-driven documentation discovery and validation.
read_when:
  - Creating durable docs or adding repository documentation tooling.
---

# T02 — Make docs self-indexing

## Goal

Let agents find relevant documentation without reading the entire tree.

## Prerequisites

Complete T00–T01. Review all current `docs/**/*.md` files.

## Deliverables

- `scripts/docs-list.mjs`, using only Node or already-declared dependencies.
- Root package scripts: `docs:list` and `docs:check`.
- YAML frontmatter on every durable current/new doc: non-empty string `summary`, non-empty string array `read_when`.

The script recursively walks `docs/**/*.md`, skips hidden/generated/vendor paths, prints path/summary/read triggers, and returns non-zero under `--check` for missing/malformed metadata. It makes no network or AI calls.

## Acceptance evidence

Run `npm run docs:list` and `npm run docs:check`. Demonstrate malformed or missing metadata fails in a temporary fixture, then remove it.

## Handoff

Commit suggestion: `chore: add agent-friendly documentation index`. Next: [T03](T03-development-skills.md).
