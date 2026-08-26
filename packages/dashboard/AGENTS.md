# Dashboard package instructions

`packages/dashboard` is a Next.js presentation adapter. Durable truth comes from server APIs and WebSocket events; Zustand stores hold local presentation state and synchronized projections, not an independent runtime model.

- Use `src/lib/api.ts` and `src/lib/ws.ts` for the dashboard-server boundary. Do not read server files or product persistence directly.
- Parse HTTP responses and WebSocket payloads before updating stores. TypeScript return annotations and assertions do not validate network data.
- Add inbox renderers and commands through plugin manifests and registries. Do not import a plugin component directly into layout or page code.
- Keep server event contracts and store transitions explicit when adding chat or runtime event types.
- Reuse existing UI primitives and preserve keyboard, loading, error, empty, and reconnect states.
- Add focused component/store tests for visible behavior and state transitions.

Verify with `corepack pnpm --filter @agent-harness/dashboard run typecheck` and `corepack pnpm --filter @agent-harness/dashboard test`. The typecheck generates Next.js route types before invoking TypeScript. Run the root build for routing, configuration, or production-bundle changes, and do not force-add ignored generated output.

<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
