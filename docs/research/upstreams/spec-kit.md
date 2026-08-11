---
summary: Assess GitHub Spec Kit for durable spec-to-plan-to-task artifacts.
read_when:
  - Revising planning templates or considering workflow automation.
---

# GitHub Spec Kit

- Source: https://github.com/github/spec-kit
- Revision: `9d15554c08ac5d01dc669dbd1a161a9638bc673b` (`HEAD` observed 2026-08-10)
- License: MIT.

## Assessment

- Useful concepts: separate intent, technical plan, task breakdown, implementation, and cross-artifact checks.
- Smallest immediate adoption: keep lightweight local spec/plan/task templates and `PLANS.md`; require links between artifacts when work is substantial.
- Deferred: a workflow engine, catalogs, CLI installation, gates, and template rendering until manual planning becomes a measured bottleneck.
- Not adopted: upstream templates, commands, generated project structure, or shell-capable workflow execution.
- Agent Harness mapping: planning artifacts should describe runtime behavior before code, particularly persistence and delegation semantics.
