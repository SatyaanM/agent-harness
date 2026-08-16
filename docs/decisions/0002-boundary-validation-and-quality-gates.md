---
summary: Adopt parse-once trust boundaries and layered executable quality gates for Agent Harness.
read_when:
  - Adding external inputs, persisted schemas, provider adapters, privileged tools, tests, or repository quality gates.
---

# ADR 0002: Parse once at trust boundaries and enforce quality in layers

Status: Accepted
Date: 2026-08-11

## Context

Strict TypeScript proves properties only after values have a trustworthy runtime shape. Agent Harness receives values from HTTP, WebSocket, environment variables, persisted files, plugin manifests, model providers, tools, subprocesses, and external APIs. Several current boundaries rely on assertions or ad hoc property checks. At the same time, validating every internal call would add cost and complexity without improving trust.

Local hooks improve feedback but are bypassable. Expensive security, mutation, and timing checks are unsuitable for every edit. The repository therefore needs both a precise validation boundary and layered enforcement.

## Decision

Every value entering from outside the current trusted process or from serialized durable state begins as `unknown` and is parsed exactly once by the adapter or domain owner before trusted use. Zod is the default validator. Core owns framework-neutral domain schemas; server and dashboard own transport-specific schemas and error mapping. Internal values constructed exclusively from validated types do not require repeated runtime parsing.

Validation failure follows the durability profile of the data. Invalid client input is rejected, invalid provider data fails as an upstream protocol error, invalid browser data is not committed to state, invalid critical durable data is preserved and surfaced, and invalid derived data may be rebuilt. Validation must preserve transcript content verbatim.

Repository enforcement is layered: fast staged checks, a credential-free full local check, deeper CI coverage/integration/budget checks, a separate network-dependent security audit, and nightly mutation/fuzz/performance work. Protected CI is authoritative; hooks are early feedback. Static policy checks use parsed TypeScript syntax and resolved configurations, with explicit expiring exceptions rather than an unbounded legacy allowlist.

## Alternatives considered

- **Ad hoc route and file checks.** Rejected because assertions and partial checks drift and do not establish a visible trust boundary.
- **Validate every function argument.** Rejected because it repeats work in hot internal paths and makes ownership unclear.
- **Create a new contracts package immediately.** Deferred because current shared contracts can remain framework-neutral in core; a new package is justified only if ownership becomes clearer through provider and API expansion.
- **Run every check in every Git hook.** Rejected because slow hooks encourage bypass and timing/security checks are not deterministic on every workstation.

## Consequences

- Boundary modules and schemas become explicit extension points and require failure-path tests.
- Existing assertions, raw JSON reads, and unparsed client responses must migrate before the corresponding static rules become blocking.
- Validation adds bounded ingress cost but avoids repeated internal parsing. Hot paths must be measured before changing validators.
- Durable corruption becomes visible rather than silently ignored, which may expose legacy data that needs quarantine or migration.
- CI configuration becomes a required follow-up; local hooks alone cannot satisfy this decision.

## Evidence and supersession

This decision reinforces, without superseding, the package, persistence, delivery, and transcript invariants in [`ARCHITECTURE_DECISIONS.md`](../ARCHITECTURE_DECISIONS.md). Its enforcement is implemented by the root quality scripts, CI workflows, boundary schemas, and focused failure-path tests.
