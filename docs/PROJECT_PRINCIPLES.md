---
summary: Durable product and engineering principles that constrain Agent Harness design and development.
read_when:
  - Designing a cross-cutting runtime, persistence, provider, plugin, or agent-development change.
  - Resolving tradeoffs not already decided by a narrower specification or ADR.
---

# Project principles

## Product direction

Agent Harness is a local-first, browser-operated environment for observable, durable agent work. The server owns execution and durable state; the dashboard presents and controls that state. The system should become easier to extend and inspect without weakening safety or recoverability.

## Engineering principles

1. **Verify before describing.** Keep implemented behavior, target direction, and hypotheses visibly separate. Source and executable checks outrank stale prose.
2. **Preserve boundaries.** Core owns framework-neutral domain/runtime logic; server and dashboard are adapters. Durable truth remains server-owned.
3. **Make delivery durable.** Agents do not poll workers. Preserve addressable sessions, mailbox delivery, transcript fidelity, single-writer persistence, atomic drains, and wake guards.
4. **Extend through contracts.** Prefer registries, manifests, tools, APIs, and events over hard-coded dispatch or filesystem coupling.
5. **Design persistent concepts deliberately.** Identity, conversation, task, execution run, and session are not interchangeable. Cross-cutting ontology changes require a spec and ADR before migration.
6. **Use proportional process.** Trivial, local work needs no ceremony. Foundational runtime, persistence, security-boundary, or compatibility work needs explicit design, plan, tests, and durable decisions.
7. **Keep adaptation traceable.** Borrow the smallest useful external concept, pin provenance, respect licenses, and document deferrals and non-adoptions.
8. **Prefer deterministic evidence.** Repository checks must be local, non-mutating, reproducible, and independent of API keys. Report failures rather than masking them.
9. **Preserve user work.** Respect dirty trees, use recoverable migrations, avoid surprise dependency or environment changes, and make destructive scope explicit.
10. **Improve through dogfooding.** Repository instructions, skills, docs, and checks should let a fresh agent discover the same constraints without hidden conversation context.

Narrower accepted specs and ADRs may refine these principles. A proposed contradiction must be called out and decided explicitly rather than introduced incidentally.
