# Server package instructions

`packages/server` is the validated transport and host adapter around core. Keep routes thin: validate input, call the relevant manager or core API, translate results, and centralize runtime or lifecycle coordination outside route handlers.

- Treat request params, query, body, configured URLs, and serialized server state as `unknown` until parsed. Do not use type assertions as request validation.
- The server owns durable sessions, the open-session set, loaded runtimes, plugin discovery, and WebSocket event publication.
- Preserve the loaded-session gate and durable-mailbox behavior when changing `SessionManager` or session routes.
- Add lifecycle behavior through the hook bus and respect before-middleware versus after-observer semantics.
- Import product behavior from `@agent-harness/core`; do not duplicate core persistence, tool, or orchestration logic.
- Return stable client-safe error envelopes; do not disclose internal paths, stack traces, or provider secrets.
- Add route/manager tests for validation, error mapping, state transitions, and emitted events.

Verify with `corepack pnpm --filter @agent-harness/server run typecheck` and `corepack pnpm --filter @agent-harness/server test`. Run the root suite when core contracts or dashboard-visible APIs change.
