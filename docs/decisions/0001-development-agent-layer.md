---
summary: Decision separating repository-development agent tooling from future Agent Harness runtime skills and agents.
read_when:
  - Changing .agents, .codex, product agent configuration, or planning runtime skills and tool loading.
  - Deciding whether an agent-facing artifact belongs to development tooling or product runtime architecture.
---

# ADR 0001: Separate development-agent tooling from product runtime capabilities

Status: Accepted
Date: 2026-08-10

## Context

Agent Harness already loads product agent configurations from `agents/*.md` and may later add a product runtime skill model. This repository also needs instructions, reusable workflows, and specialist agents for Codex sessions that develop the product. Using one directory or loader for both would confuse trusted development context with user-visible runtime behavior and could accidentally turn bootstrap work into a product feature.

## Decision

Repository-development tooling lives in `AGENTS.md`, `.agents/skills/`, and `.codex/`. These files guide coding agents and are not read by the Agent Harness server or dashboard.

Product agent configuration remains under `agents/`. The root name `skills/` is reserved for a future product/runtime capability and must not be created or loaded until a dedicated runtime spec, ontology, security model, persistence design, and ADR authorize it.

Documentation must label which layer it describes. Development tooling must not claim to configure harness providers, agents, tools, or runtime execution.

## Alternatives considered

- **Share one skills directory and loader:** rejected because development trust and product runtime trust have different users, lifecycle, and security boundaries.
- **Store development workflows only in prompts or personal configuration:** rejected because repository contributors need versioned, discoverable, reviewable context.
- **Implement runtime skills during bootstrap:** rejected because the product contract and ontology are not designed yet.

## Consequences

The repository has two intentionally separate agent-facing layers. Some concepts may later be adapted between them, but that requires explicit provenance and product design. Bootstrap tasks can improve `.agents` and `.codex` without changing runtime behavior; future runtime work cannot infer authorization from their existence.
