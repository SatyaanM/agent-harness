---
summary: Implementation plan for Worker Roster Hydration
read_when:
  - Executing implementation tasks for Worker Roster Hydration.
---

# Worker Roster Hydration Implementation Plan

Status: Draft

## Inputs
- Governing Specification: `specs/worker-roster-hydration/SPEC.md`
- Current Codebase: `packages/dashboard/src/stores/agent-roster-store.ts`, `packages/dashboard/src/components/chat/AgentColumn.tsx`

## Sequence

### Phase 1: Server Hydration API
- **Objective**: Serve historical workers for a session.
- **Files/Symbols**:
  - [NEW] `packages/server/src/routes/workers.ts`
- **Behavior**: Implements `GET /api/sessions/:sessionId/workers` joining `tasks` and `sessions`.
- **Verification**: Test endpoint returns properly bounded, mapped `WorkerSummary` data.

### Phase 2: Store Hydration and UI
- **Objective**: Support bulk ingestion of workers into dashboard store.
- **Files/Symbols**:
  - [MODIFY] `packages/dashboard/src/stores/agent-roster-store.ts`
  - [MODIFY] `packages/dashboard/src/components/chat/RuntimeSync.tsx`
- **Behavior**: Implements `hydrate` method, called on load and socket reconnect.
- **Verification**: Simulate reload and confirm workers are rendered.

### Phase 3: DAG Visualization and Paused States
- **Objective**: Extend UI for advanced state management.
- **Files/Symbols**:
  - [MODIFY] `packages/dashboard/src/components/chat/AgentColumn.tsx`
  - [MODIFY] `packages/dashboard/src/components/chat/AgentDrawer.tsx`
- **Behavior**: Renders DAG links between workers based on dependencies; adds support for visualizing and resuming `paused` workers.
- **Verification**: Visual inspection via Playwright tests.
