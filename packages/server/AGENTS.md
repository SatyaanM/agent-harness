# Server package instructions

`packages/server` is the validated transport and host adapter around core. Keep routes thin: validate input, call the relevant manager or core API, translate results, and centralize runtime or lifecycle coordination outside route handlers.

- The server owns durable sessions, the open-session set, loaded runtimes, plugin discovery, and WebSocket event publication.
- Preserve the loaded-session gate and durable-mailbox behavior when changing `SessionManager` or session routes.
- Add lifecycle behavior through the hook bus and respect before-middleware versus after-observer semantics.
- Import product behavior from `@agent-harness/core`; do not duplicate core persistence, tool, or orchestration logic.
- Add route/manager tests for validation, error mapping, state transitions, and emitted events.

Verify with `corepack npm run typecheck --workspace @agent-harness/server` and `corepack npm test --workspace @agent-harness/server`. Run the root suite when core contracts or dashboard-visible APIs change.
