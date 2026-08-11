# Dashboard package instructions

`packages/dashboard` is a Next.js presentation adapter. Durable truth comes from server APIs and WebSocket events; Zustand stores hold local presentation state and synchronized projections, not an independent runtime model.

- Use `src/lib/api.ts` and `src/lib/ws.ts` for the dashboard-server boundary. Do not read server files or product persistence directly.
- Add inbox renderers and commands through plugin manifests and registries. Do not import a plugin component directly into layout or page code.
- Keep server event contracts and store transitions explicit when adding chat or runtime event types.
- Reuse existing UI primitives and preserve keyboard, loading, error, empty, and reconnect states.
- Add focused component/store tests for visible behavior and state transitions.

Verify with `corepack npm run typecheck --workspace @agent-harness/dashboard` and `corepack npm test --workspace @agent-harness/dashboard`. Run the root build for routing, configuration, or production-bundle changes. Restore unrelated generated `next-env.d.ts` residue after builds.
