---
summary: Assess Letta for durable agent identity, memory, and state-management concepts.
read_when:
  - Designing runtime identity, persistence, or memory semantics.
---

# Letta

- Source: https://github.com/letta-ai/letta
- Revision: `ff19ffeafeb54bd2a7dc5d4a552f10191732a235` (`HEAD`/`main` observed 2026-08-10)
- License: Apache-2.0.

## Assessment

- Useful concepts: durable agent identity, explicit memory/state, message history, tools, and server-managed lifecycle.
- Smallest immediate adoption: use its conceptual separation as a comparison point while documenting Agent Harness's current ontology in T09.
- Deferred: memory blocks, archival memory, external persistence, and long-lived agent APIs until current session semantics are specified and tested.
- Not adopted: server, SDK, database model, prompts, or memory implementation.
- Agent Harness mapping: helps challenge the current coupling among `Agent`, session runtime, transcripts, and UI session state.
