---
summary: Record external-source provenance and compact research notes for deliberate future adaptation.
read_when:
  - Adapting third-party prompts, skills, code, or architectural patterns.
---

# T07 — Add provenance registry and upstream research

## Goal

Make cannibalization traceable rather than implicit.

## Prerequisites

Complete T06. Browse/research sources only as needed and do not guess license data.

## Deliverables

Create `THIRD_PARTY_NOTICES.md`, `docs/research/upstreams/README.md`, and compact notes for: agent-skills-standard, agents-md, steipete-agent-scripts, superpowers, spec-kit, anthropic-skills, openai-codex, ecc, awesome-agent-skills, awesome-copilot, awesome-claude-code, letta, hermes-agent, and mastra.

Each note records source URL, pinned revision/release where available, license/uncertainty, useful concepts, smallest immediate adoption, deferrals, non-adoptions, and mapping to Agent Harness. Label discovery catalogs as catalogs, not endorsements. Every copied/adapted T03 asset must appear in notices.

## Handoff

Commit suggestion: `docs: add upstream research and provenance registry`. Next: [T08](T08-verification-hooks.md).
