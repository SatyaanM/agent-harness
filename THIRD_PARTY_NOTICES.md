---
summary: Track external material consulted or adapted during Agent Harness development.
read_when:
  - Copying or adapting third-party code, prompts, skills, templates, or architecture.
---

# Third-party notices

This registry records research and adaptation provenance. It is not a substitute for the license text in an upstream repository, and a catalog entry is not an endorsement of the projects it links to.

## Bootstrap provenance

No third-party source code, prompt text, or skill body was copied into the pre-development bootstrap as of 2026-08-10.

The eight workflows in `.agents/skills/` were written specifically for this repository. Their folder structure, required metadata, progressive-disclosure model, and validation approach were informed by:

- OpenAI, [Build Skills](https://learn.chatgpt.com/docs/build-skills), accessed 2026-08-10.
- The bundled OpenAI `skill-creator` workflow, used to initialize and validate each local skill.
- Agent Skills, [agentskills/agentskills](https://github.com/agentskills/agentskills), revision `69ef37e9424c0a7ea9dd2293b559e43ec8176379`; repository code is Apache-2.0 and documentation is CC-BY-4.0.

The repository-local specialists in `.codex/agents/` were configured from OpenAI's [Subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents) documentation, accessed 2026-08-10. No example agent prompt was copied.

## Locally authored T03 assets

These files are original repository instructions, not adapted copies:

- `.agents/skills/design-before-change/SKILL.md`
- `.agents/skills/implementation-planning/SKILL.md`
- `.agents/skills/test-driven-development/SKILL.md`
- `.agents/skills/systematic-debugging/SKILL.md`
- `.agents/skills/verification-before-completion/SKILL.md`
- `.agents/skills/code-review/SKILL.md`
- `.agents/skills/docs-and-decisions/SKILL.md`
- `.agents/skills/source-cannibalization/SKILL.md`

Their `agents/openai.yaml` interface manifests were generated with the bundled `skill-creator` helper and then reviewed locally. They contain repository-specific labels and prompts.

## Research-only sources

The sources indexed in `docs/research/upstreams/` were inspected for concepts only. No material from those repositories is currently redistributed here. Before importing anything later, pin the exact source revision, inspect the license at the relevant path, record the files and modifications here, preserve required notices, and obtain approval for ambiguous or non-open terms.

Repositories with mixed or restrictive boundaries require particular care:

- `anthropics/skills`: most directories are Apache-2.0, while document-related skill directories use separate source-available terms.
- `agentskills/agentskills`: code and documentation have different licenses.
- `mastra-ai/mastra`: core is Apache-2.0; `ee/` paths use the Mastra Enterprise License.
- `hesreallyhim/awesome-claude-code`: the catalog is CC-BY-NC-ND-4.0; use it for discovery only and review every linked project's own license.

See [the upstream research index](docs/research/upstreams/README.md) for pinned revisions, license notes, deferrals, and Agent Harness mappings.
