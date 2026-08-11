# Agent Harness development instructions

## Start here

Read `README.md`, then the durable document that matches the change. Use `docs/ARCHITECTURE_DECISIONS.md` for established runtime and UI invariants, `docs/DELEGATE_FEATURE_SPEC.md` for delegation behavior, and `specs/` for active plans. Inspect source before treating design intent as implemented behavior.

## Repository layout

- `packages/core`: framework-neutral agent, tool, capability, persistence, collaboration, plugin-contract, and TTS logic.
- `packages/server`: Express/Socket.IO host, API validation, lifecycle hooks, runtime ownership, and filesystem adapters.
- `packages/dashboard`: Next.js UI, client-side presentation stores, API/WebSocket clients, and registry-backed renderers.
- `agents`: markdown configurations loaded by the Agent Harness product at runtime.
- `.codex` and `.agents/skills`: development tooling for coding agents; they are not product runtime features.
- `docs` and `specs`: durable decisions, verified current-state documentation, and implementation plans.

## Hard invariants

- Preserve the package boundary: core must not depend on HTTP or UI frameworks; server and dashboard remain adapters.
- Delivery is system-owned. Agents do not poll workers; completion enters a durable mailbox and wakes a loaded delegating runtime.
- Preserve transcript fidelity, the single-writer persistence path, atomic mailbox drain, and wake-run guard semantics.
- Durable session, open-session, plugin, and runtime state is server-owned. Dashboard stores may cache or present it but must resynchronize from server APIs and events.
- Extend tools and renderers through their registries and manifests. Do not add hard-coded dispatch branches that bypass an extension point.
- Treat `.agents/skills/` as repository-development workflows. The reserved future product `skills/` capability needs its own runtime design and must not be introduced incidentally.

## Working method

Keep changes scoped. Trivial fixes can proceed directly; cross-cutting runtime or persistence changes require an updated spec or plan, and durable architectural choices require an ADR. Record third-party adaptations with an exact source, revision, license status, and the smallest borrowed concept.

Do not overwrite unrelated work in a dirty tree, upgrade dependencies without need, or present roadmap intent as current behavior. Update directly affected docs when behavior or an invariant changes.

## Verification

Use the repository-pinned npm through Corepack:

```powershell
corepack npm run typecheck
corepack npm test
corepack npm run build
git diff --check
```

Run focused package tests while iterating, then proportional root checks before completion. A Next.js build may rewrite `packages/dashboard/next-env.d.ts`; do not retain generated residue unrelated to the task.
