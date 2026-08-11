---
summary: Add deterministic validation for repo-local development skills.
read_when:
  - Adding or changing .agents/skills content or validation tooling.
---

# T04 — Add deterministic skill validation

## Goal

Fail fast when a repository development skill is malformed.

## Prerequisites

Complete T03 and review the public Agent Skills constraints.

## Deliverables

Add `scripts/validate-skills.mjs` and `npm run skills:validate`. Validate all `.agents/skills/*/SKILL.md` files, including frontmatter validity, unique names, and skill name/directory consistency. When an optional `agents/openai.yaml` exists, also validate its required interface strings, description length, and a default prompt that explicitly names the skill. Keep it local and deterministic; use agent-scripts as behavioral inspiration only.

## Acceptance evidence

Show valid skills pass. In temporary fixtures, prove duplicate names, malformed frontmatter, directory/name mismatch, and malformed optional UI metadata fail. Remove all temporary fixtures before completion.

## Handoff

Commit suggestion: `chore: validate repository agent skills`. Next: [T05](T05-codex-specialists.md).
