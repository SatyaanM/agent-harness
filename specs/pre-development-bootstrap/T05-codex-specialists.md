---
summary: Configure narrowly scoped, read-heavy Codex specialist agents for repository work.
read_when:
  - Adding Codex project configuration or specialist-agent definitions.
---

# T05 — Add project-scoped Codex specialist agents

## Goal

Improve exploration and review quality without changing the harness product.

## Prerequisites

Complete T04; confirm current Codex project configuration syntax from official guidance.

## Deliverables

Create `.codex/config.toml` and specialist definitions for `repo-explorer`, `architecture-reviewer`, `test-reviewer`, and `docs-researcher` under `.codex/agents/`. Make exploration/review roles read-only unless explicitly justified.

## Acceptance

Definitions are narrow, contain no secrets/personal paths/subscription-specific model pins, and documentation calls `.codex` development tooling rather than product architecture.

## Handoff

Commit suggestion: `chore: add project-scoped Codex reviewers`. Next: [T06](T06-planning-artifacts.md).
