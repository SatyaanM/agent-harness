---
summary: Specification for the daily automated AI harness research framework, intelligence ingestion sources, and RICE feature evaluation protocol.
read_when:
  - Conducting or scheduling daily research on state-of-the-art AI harnesses and agent architectures.
  - Evaluating new candidate features using the standardized RICE scoring matrix.
---

# Daily Cutting-Edge AI Harness Research Specification

Status: Proposed

## Problem and evidence

The landscape of AI agent frameworks, model protocols, sandboxing engines, and developer harnesses is evolving at an unprecedented pace. Without a structured, recurring process to ingest, evaluate, and prioritize breakthroughs:
1. Architectural innovations (such as AST repo-mapping, Model Context Protocol extensions, speculative tool evaluation, or sub-turn streaming) can be missed or implemented haphazardly.
2. Engineering effort risks being spent on low-impact or high-overhead features that don't align with Agent Harness core invariants.
3. Decision-making lacks an objective, repeatable prioritization framework.

## Goals and non-goals

### Goals
- Establish a daily recurring research routine (triggerable via `/schedule` or cron at 08:00 UTC) to scan cutting-edge AI harness developments.
- Systematically survey authoritative intelligence streams: Model Context Protocol (MCP) specifications, open-source orchestrators (LangGraph, AutoGen, CrewAI, DSPy), coding harnesses (Claude Code CLI, Aider, OpenHands, Smolagents), and arXiv research preprints.
- Evaluate all discovered feature ideas through a calibrated **RICE Scoring Matrix** (Reach × Impact × Confidence / Effort).
- Output a single highest-impact, lowest-effort feature proposal every day formatted according to `specs/daily-ai-research/TEMPLATE.md`.
- Ensure all proposed features adhere to Agent Harness hard invariants (package isolation, strict type safety, zero silent data loss, parse-once boundaries).

### Non-goals
- Blindly adopting heavy external frameworks or bloating the codebase with speculative dependencies.
- Autonomously committing unapproved feature implementations without engineering review and ADR approval.

## Required behavior

### 1. Daily Ingestion Sources & Focus Areas
Every daily run surveys four primary intelligence streams:
1. **Protocols & Standards**: Model Context Protocol (MCP) updates, OpenAI Realtime API protocols, tool schema extensions.
2. **Coding Harnesses**: Claude Code CLI architectures, Aider AST repo-maps, OpenHands Docker sandbox patterns, SWE-agent prompt compaction.
3. **Multi-Agent Orchestration**: LangGraph checkpointing graphs, AutoGen group chat consensus, DSPy assertion pipelines.
4. **Agent Research & Preprints**: LLM-as-OS papers, speculative tool execution, dynamic context compaction, verifiable agent sandboxing.

### 2. Standardized RICE Scoring Formula
Each candidate feature is scored using:
$$\text{RICE Score} = \frac{\text{Reach} \times \text{Impact} \times \text{Confidence}}{\text{Effort (Engineering Days)}}$$

- **Reach (1–10)**: Estimated percentage of sessions, tools, or agents utilizing the feature.
  - `10`: Universal (affects every turn/message, e.g. token streaming, SQLite WAL).
  - `7`: Broad (affects all tool-calling agents).
  - `4`: Moderate (affects specific subagents or renderers).
  - `1`: Niche (rare edge case).
- **Impact (1–5)**:
  - `5`: Radical capability leap (e.g. streaming tool execution, transactional rollback).
  - `4`: High resilience/observability gain (e.g. worker crash reconciliation, OTel spans).
  - `3`: Noticeable latency/DX speedup (e.g. AST repo-map cache).
  - `2`: Minor UI/convenience improvement.
  - `1`: Cosmetic tweak.
- **Confidence (0.1–1.0)**: Certainty that the implementation will succeed without breaking architectural invariants.
- **Effort (0.5–5.0 Days)**: Total engineering effort required (including tests, schemas, and ADR).

### 3. Deliverable Output Contract
Each daily execution generates a markdown artifact at `specs/daily-research/YYYY-MM-DD.md` documenting:
- Executive summary of key upstream discoveries.
- Comparative candidate evaluation table with calculated RICE scores.
- Comprehensive technical design for the #1 selected winning feature.
- Explicit package boundaries, affected files, required tests, and potential architectural risks.

## Acceptance criteria

1. Daily research artifact is generated with all sections filled and valid YAML frontmatter.
2. Every proposed candidate feature includes a cited upstream source and a calculated RICE score.
3. The selected top feature has a clearly scoped vertical slice implementation plan with zero violations of `AGENTS.md` invariants.

## Open questions and decisions

- Governing Process: Triggerable manually or automatically via the Agent Harness `/schedule` slash command.
- Storage: Daily reports are stored under `specs/daily-research/` and indexed in `specs/README.md`.
