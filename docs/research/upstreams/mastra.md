---
summary: Assess Mastra for agent, workflow, tool, and observability boundaries.
read_when:
  - Designing workflow execution or runtime extension boundaries.
---

# Mastra

- Source: https://github.com/mastra-ai/mastra
- Revision: `e91cae43fde53da7f86e5de3ab4c723149ce7c9b` (`HEAD` observed 2026-08-10)
- License: mixed. Core packages are Apache-2.0; paths under `ee/` use the Mastra Enterprise License. Verify the exact path before use.

## Assessment

- Useful concepts: explicit separation among agents, workflows, tools, memory, evaluation, and observability.
- Smallest immediate adoption: compare those boundaries with Agent Harness's current ontology and identify coupled concepts before changing code.
- Deferred: workflow DSLs, storage adapters, observability infrastructure, and evaluation frameworks until a focused runtime plan exists.
- Not adopted: packages, enterprise code, APIs, schemas, or framework conventions.
- Agent Harness mapping: offers a mature comparison point for `Orchestrator`, `SessionRuntime`, tool registry, and future durable workflows.
