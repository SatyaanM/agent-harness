---
summary: Track external material consulted or adapted during Agent Harness development.
read_when:
  - Copying or adapting third-party code, prompts, skills, templates, or architecture.
---

# Third-party notices

This registry records provenance for external material that directly informed repository content. It is not a substitute for the license text in an upstream repository.

## Development-tooling provenance

No third-party source code, prompt text, or skill body was copied into the repository-development tooling.

The eight workflows in `.agents/skills/` were written specifically for this repository. Their folder structure, required metadata, progressive-disclosure model, and validation approach were informed by:

- OpenAI, [Build Skills](https://learn.chatgpt.com/docs/build-skills), accessed 2026-08-10.
- The bundled OpenAI `skill-creator` workflow, used to initialize and validate each local skill.
- Agent Skills, [agentskills/agentskills](https://github.com/agentskills/agentskills), revision `69ef37e9424c0a7ea9dd2293b559e43ec8176379`; repository code is Apache-2.0 and documentation is CC-BY-4.0.

The repository-local specialists in `.codex/agents/` were configured from OpenAI's [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) documentation, accessed 2026-08-10. No example agent prompt was copied. The skill interface manifests were generated with the bundled `skill-creator` helper and reviewed locally; their labels and prompts are repository-specific.

Before copying or adapting external material in the future, pin the exact source revision, inspect the license at the relevant path, record the local destination and modifications here, and preserve required notices.
