---
summary: Principles for evolving Agent Harness runtime architecture without prescribing an incidental rewrite.
read_when:
  - Designing the next runtime phase or evaluating a cross-cutting architecture proposal.
---

# Target runtime direction

This document records direction, not an approved implementation. It does not authorize schema changes, new runtime features, or a broad refactor. Each material change still needs a specification, migration strategy, focused tests, and an implementation plan.

## Product boundary

Agent Harness should remain a web-native orchestration application:

- the server owns execution, durable state, authorization, and filesystem effects;
- the dashboard is an observable, resumable projection over server contracts;
- core contains framework-neutral runtime policies and contracts;
- development-agent configuration in `.agents/` and `.codex/` remains outside product runtime architecture.

## Directional principles

### 1. Give durable concepts explicit identities

Persistent agent definitions, conversations, delegated tasks, execution runs, and messages/events should not share IDs by convention. IDs should be opaque, stable, and accompanied by schema versions. Display names and filenames are attributes, not identity.

### 2. Separate durable records from live executors

A runtime, model call, abort controller, or socket connection is ephemeral. Its durable task/run record should make startup reconciliation possible and should explain whether work is queued, running, completed, failed, cancelled, abandoned, or safe to retry.

### 3. Make delivery idempotent and observable

Worker completion should have a durable event identity, an explicit delivery state, and a deterministic projection into the parent conversation. Repeated recovery must not duplicate a completion, and partial failure must not make it disappear silently.

### 4. Preserve transcript fidelity without making transcripts the only model

Conversation messages remain an audit-friendly user record, but task/run state should not be inferred solely from prose messages or `worker-` filename prefixes. Tool calls, run outcomes, and delivery events need stable associations.

### 5. Enforce limits and capabilities at the execution boundary

Concurrency, cancellation, allowed tools, filesystem scope, provider protocol, and model capabilities should be checked where work starts. A setting that is not enforced should not be presented as a guarantee.

### 6. Model providers by protocol and configuration

Provider selection should be explicit rather than inferred from a model-name allowlist. The design should separate endpoint/credentials, protocol adapter, model identity, and capabilities while keeping secrets server-side.

### 7. Keep extensions declarative at trust boundaries

Plugin/skill/tool manifests should be schema-validated and capability-scoped. Metadata discovery must not imply permission to execute arbitrary code. Runtime loading, if added, needs an explicit trust, versioning, and isolation model.

### 8. Treat UI state as a recoverable projection

Tabs, rosters, running indicators, and activity feeds should resynchronize from durable server facts and events. Browser state may optimize presentation but must not become the sole record of work or delivery.

### 9. Version persistence and design migrations before mutation

Every persistent schema change needs compatibility rules, startup behavior for old/corrupt/partial records, rollback expectations, and fixtures. Prefer append-compatible or additive transitions over one-shot rewrites.

### 10. Grow through tested vertical slices

First protect current delivery and persistence semantics with tests. Then introduce one concept boundary at a time behind adapters. Avoid a simultaneous rewrite of storage, orchestration, providers, plugins, and UI.

## Desired qualities

The target runtime should be:

- **durable:** accepted work has an explainable outcome after restart;
- **deterministic at boundaries:** IDs, transitions, delivery, and migrations are testable;
- **observable:** users can distinguish queued work, live execution, stale execution, and delivered results;
- **provider-neutral by contract:** adapters declare protocols and capabilities;
- **secure by construction:** authorization and isolation are enforcement mechanisms, not prompt conventions;
- **extensible deliberately:** new tools, skills, and UI surfaces cross validated registries;
- **incrementally adoptable:** existing transcripts and workflows remain usable through migration.

## Explicit non-goals for the next phase

- no runtime `skills/` implementation;
- no marketplace or arbitrary plugin code loader;
- no session branching, compaction, or autonomous memory system;
- no database selection before lifecycle and consistency requirements are written;
- no adoption of an external agent framework wholesale;
- no attempt to preserve unused parallel orchestration implementations merely because they are exported.

Those may become later design topics. They are not prerequisites for clarifying identity, lifecycle, persistence, and delivery.
