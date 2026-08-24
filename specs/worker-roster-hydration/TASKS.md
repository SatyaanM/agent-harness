---
summary: Implementation tasks for Worker Roster Hydration
read_when:
  - Checking progress on Worker Roster Hydration tasks.
---

# Worker Roster Hydration Tasks

- [ ] Implement `GET /api/sessions/:sessionId/workers` endpoint in `packages/server/src/routes/workers.ts`.
- [ ] Implement SQL join logic to map `tasks` database rows to `WorkerSummary` schema.
- [ ] Add `hydrate(workers)` action to `useRosterStore` in `packages/dashboard/src/stores/agent-roster-store.ts`.
- [ ] Hook hydration fetch into `RuntimeSync.tsx` on initialization and socket reconnect.
- [ ] Update `AgentColumn.tsx` to handle `paused` worker states visually.
- [ ] Implement DAG dependency visualization linking parent/child task bubbles.
- [ ] Update `AgentDrawer.tsx` to display full transcript of hydrated/historical workers.
- [ ] Add Resume button for paused workers in the UI inspector.
