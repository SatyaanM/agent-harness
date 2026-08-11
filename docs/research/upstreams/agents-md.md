---
summary: Assess AGENTS.md conventions for scoped repository instructions.
read_when:
  - Changing repository instruction hierarchy.
---

# AGENTS.md

- Source: https://github.com/agentsmd/agents.md
- Revision: `d1ac7f063d20e70015ed6732664049ae4ba9d74e` (`HEAD` observed 2026-08-10)
- License: MIT.

## Assessment

- Useful concepts: version-controlled agent guidance, nearest-file scoping, and instructions colocated with code.
- Smallest immediate adoption: retain the root instructions plus focused package overrides already added in T01.
- Deferred: additional nested files until a subtree has meaningfully different commands or invariants.
- Not adopted: duplicating human documentation or encoding task-specific plans in standing instructions.
- Agent Harness mapping: `AGENTS.md` improves development consistency but is not runtime configuration for Agent Harness agents.
