# Agent Harness development instructions

## Start here

Read `README.md`, then `docs/architecture/CURRENT_STATE.md` for verified implementation status and the durable document that matches the change. Use `docs/ARCHITECTURE_DECISIONS.md` for governing invariants and historical intent, `docs/DELEGATE_FEATURE_SPEC.md` for delegation behavior, and `specs/` for active plans. Source and `CURRENT_STATE.md` take precedence when older design prose presents intent as behavior.

## Repository layout

- `packages/core`: framework-neutral agent, tool, capability, persistence, collaboration, plugin-contract, and TTS logic.
- `packages/server`: Express/Socket.IO host, API validation, lifecycle hooks, runtime ownership, and filesystem adapters.
- `packages/dashboard`: Next.js UI, client-side presentation stores, API/WebSocket clients, and registry-backed renderers.
- `agents`: markdown configurations loaded by the Agent Harness product at runtime.
- `.codex` and `.agents/skills`: development tooling for coding agents; they are not product runtime features.
- `docs` and `specs`: durable decisions, verified current-state documentation, and implementation plans.

## Hard invariants

- Preserve the package boundary: core must not depend on HTTP or UI frameworks; server and dashboard remain adapters.
- Keep every TypeScript project in strict mode. Package configurations must not weaken strict compiler flags or suppress type errors to cross a trust boundary.
- Treat HTTP, WebSocket, environment, filesystem, persisted, plugin, provider, subprocess, and tool data as `unknown` until the owning boundary parses it. Parse once, then use validated types internally.
- Validation failure must follow the data's durability profile: reject invalid input, preserve invalid durable truth for diagnosis, and rebuild only derived state. Never silently drop mailbox or transcript records.
- Delivery is system-owned. Agents do not poll workers; completion enters a durable mailbox and wakes a loaded delegating runtime.
- Preserve transcript fidelity, the single-writer persistence path, atomic mailbox drain, and wake-run guard semantics.
- Durable session, open-session, plugin, and runtime state is server-owned. Dashboard stores may cache or present it but must resynchronize from server APIs and events.
- Extend tools and renderers through their registries and manifests. Do not add hard-coded dispatch branches that bypass an extension point.
- Enforce performance and cost through explicit limits on concurrency, steps, delegation, retries, time, tokens, and bytes. A configured limit that is not enforced is not a capability.
- Behavior changes require focused automated tests for their success and important failure paths. Coverage is a ratchet and supporting evidence, not a substitute for meaningful assertions.
- Treat `.agents/skills/` as repository-development workflows. The reserved future product `skills/` capability needs its own runtime design and must not be introduced incidentally.

## Working method

Keep changes scoped. Trivial fixes can proceed directly; cross-cutting runtime or persistence changes require an updated spec or plan, and durable architectural choices require an ADR. Record third-party adaptations with an exact source, revision, license status, and the smallest borrowed concept.

Do not overwrite unrelated work in a dirty tree, upgrade dependencies without need, or present roadmap intent as current behavior. Update directly affected docs when behavior or an invariant changes.

## Verification

Use the repository-pinned npm through Corepack:

```powershell
corepack npm run quality
corepack npm run typecheck
corepack npm test
corepack npm run build
git diff --check
```

Use `corepack npm run check` for the complete credential-free handoff suite and `corepack npm run test:coverage` when test scope or coverage changes. Run focused package tests while iterating, then proportional root checks before completion. A Next.js build may rewrite `packages/dashboard/next-env.d.ts`; do not retain generated residue unrelated to the task.
