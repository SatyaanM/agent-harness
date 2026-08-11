---
summary: Record OpenAI Codex configuration guidance used by the development-agent layer.
read_when:
  - Changing `.codex` configuration, project agents, or repository skills.
---

# OpenAI Codex

- Source: https://github.com/openai/codex
- Revision: `070a26a1f00817931a17e2cdf8fbe03a2a0ed128` (`HEAD` observed 2026-08-10)
- License: Apache-2.0.
- Documentation consulted: [Build Skills](https://learn.chatgpt.com/docs/build-skills) and [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents), accessed 2026-08-10.

## Assessment

- Useful concepts: project-local skill discovery, progressive disclosure, scoped agent roles, inherited defaults, and read-only specialist sandboxes.
- Smallest immediate adoption: the locally authored `.agents/skills` workflows and four unpinned read-only specialists in `.codex/agents`.
- Deferred: model pins, external MCP servers, and additional agents until a repository task demonstrates the need.
- Not adopted: Codex implementation code or product architecture. Documentation wording and example prompts were not copied.
- Agent Harness mapping: `.codex` config helps build Agent Harness; it is explicitly separate from runtime agent/provider configuration.
