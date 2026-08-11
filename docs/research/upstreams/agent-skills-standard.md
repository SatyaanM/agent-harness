---
summary: Assess the Agent Skills standard as the compatibility baseline for repository skills.
read_when:
  - Changing the `.agents/skills` layout or validator.
---

# Agent Skills standard

- Source: https://github.com/agentskills/agentskills
- Revision: `69ef37e9424c0a7ea9dd2293b559e43ec8176379` (`HEAD` observed 2026-08-10)
- License: repository code is Apache-2.0; documentation is CC-BY-4.0. Check per-path notices before copying.

## Assessment

- Useful concepts: a required `SKILL.md`, minimal discovery metadata, optional bundled scripts/references/assets, and progressive disclosure.
- Smallest immediate adoption: keep `.agents/skills` compatible and validate required metadata locally.
- Deferred: broader optional metadata and a runtime skill marketplace until Agent Harness has a product-level skill model.
- Not adopted: the reference implementation and example skill text; no runtime dependency is justified.
- Agent Harness mapping: this governs the development-agent layer only. Future product skills belong behind an explicit runtime design and must not be inferred from `.agents/skills`.
