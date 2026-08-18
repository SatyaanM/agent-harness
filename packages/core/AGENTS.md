# Core package instructions

`packages/core` owns framework-neutral domain and runtime behavior. Keep it independent of Express, Socket.IO, Next.js, React, browser state, and transport-specific request or response types.

- Preserve durable session and mailbox semantics in `src/persistence` and delivery/wake behavior in `src/agent`.
- Register tools through `ToolRegistry`; filesystem tools must enforce the configured root boundary.
- Keep provider integration behind `LLMClient` and capability discovery behind the capability interfaces.
- Put shared contracts in core only when server and dashboard genuinely share a domain concept; do not move adapter concerns inward for convenience.
- Parse filesystem, persisted, provider, subprocess, and tool inputs at their owning boundary. Invalid durable records must be preserved or surfaced rather than silently skipped.
- Keep validation outside hot internal loops, and enforce explicit resource budgets where core performs repeated or privileged work.
- Add focused tests for changed behavior, especially concurrency, persistence ordering, cancellation, and failure paths.

Verify with `corepack pnpm --filter @agent-harness/core run typecheck` and `corepack pnpm --filter @agent-harness/core test`. Run the root suite when exported contracts or build behavior changes.
