# Core package instructions

`packages/core` owns framework-neutral domain and runtime behavior. Keep it independent of Express, Socket.IO, Next.js, React, browser state, and transport-specific request or response types.

- Preserve durable session and mailbox semantics in `src/persistence` and delivery/wake behavior in `src/agent`.
- Register tools through `ToolRegistry`; filesystem tools must enforce the configured root boundary.
- Keep provider integration behind `LLMClient` and capability discovery behind the capability interfaces.
- Put shared contracts in core only when server and dashboard genuinely share a domain concept; do not move adapter concerns inward for convenience.
- Add focused tests for changed behavior, especially concurrency, persistence ordering, cancellation, and failure paths.

Verify with `corepack npm run typecheck --workspace @agent-harness/core` and `corepack npm test --workspace @agent-harness/core`. Run the root suite when exported contracts or build behavior changes.
