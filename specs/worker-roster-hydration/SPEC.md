---
summary: Defines the protocol and implementation for hydrating the dashboard worker roster from the server upon reconnection or page refresh.
read_when:
  - When implementing or reviewing the worker roster UI subsystem
  - When modifying WebSocket reconnection logic or the `useRosterStore`
---
Status: Draft

## Problem and evidence

Agent Harness maintains a persistent split-panel dashboard, but the worker roster is purely in-memory. Worker delegation spawns background workers tracked in the SQLite `tasks` table, and the dashboard shows workers as avatar bubbles in `AgentColumn.tsx` (which relies on `useRosterStore`). Because the store is populated only from live WebSocket events, a browser refresh or network reconnect clears the roster completely. This contradicts the "persistent dashboard" promise and severs user visibility into ongoing background tasks until they happen to emit a new event.

Evidence in codebase:
- `packages/dashboard/src/stores/agent-roster-store.ts` (`useRosterStore`) is purely in-memory.
- `packages/dashboard/src/components/chat/RuntimeSync.tsx` listens to `worker:spawned` and `worker:completed` but has no initialization hook to load preexisting state.

## Goals and non-goals

### Goals
- Ensure the worker roster accurately reflects server-side task state upon page load and WebSocket reconnection.
- Seamlessly merge fetched worker state with live WebSocket events without duplication.
- Maintain correct UI representation of worker states (queued, running, completed, failed, cancelled) across network interruptions.
- Paginate or limit the display of historical completed tasks to prevent unbounded UI growth.

### Non-goals
- Streaming worker transcripts over WebSocket (this is deferred to a separate enhancement).
- Cross-session worker views (workers will only be shown for the currently active session).
- Modifying the underlying delegation tool, worker lifecycle, or SQLite schema.

## Required behavior

### 1. Server API Enhancements

A new endpoint must be added to fetch historical and active worker tasks for a given session.

**Endpoint:** `GET /api/sessions/:sessionId/workers`

**Data Source:** The `tasks` table joined with the `sessions` table (where `tasks.parent_session_id = :sessionId`).

**Response Payload (`WorkerSummary[]`):**

```typescript
// packages/shared/src/types/worker.ts (or equivalent shared types location)
export interface WorkerSummary {
  taskId: string;
  workerSessionId: string;
  agentName: string;
  description: string;
  status: 'queued' | 'running' | 'paused' | 'completed' | 'failed' | 'cancelled' | 'abandoned';
  dependencies?: string[]; // Array of taskIds this worker is waiting on (DAG representation)
  createdAt: string; // ISO-8601
  updatedAt: string; // ISO-8601
  completedAt?: string; // ISO-8601
  lastActivitySnippet?: string; // Optional: latest message content snippet
}
```

**Filtration and Capping:**
- Returns all `running` and `queued` tasks.
- Returns `completed`, `failed`, `cancelled`, and `abandoned` tasks that occurred within the last 30 minutes.
- Implements a hard cap (e.g., maximum 50 most recent tasks overall) to bound payload size.

### 2. Dashboard State Hydration

The `useRosterStore` must be updated to support bulk idempotent state hydration.

```typescript
// packages/dashboard/src/stores/agent-roster-store.ts
export interface RosterStore {
  // Existing state...
  workers: Record<string, WorkerEntry>;

  // New action
  hydrate: (workers: WorkerSummary[]) => void;
}
```

**Hydration Logic:**
- Iterate over the incoming `WorkerSummary[]`.
- Insert or update the store's `workers` dictionary keyed by `taskId`.
- If a worker already exists (due to a racing live WebSocket event), resolve conflicts by retaining the most recent `updatedAt` timestamp.

### 3. Reconnection and Initialization Flow

`RuntimeSync.tsx` will manage the lifecycle of the roster hydration.

- **On Mount / Session Open:** Fetch `GET /api/sessions/:sessionId/workers` and call `hydrate()`.
- **On Socket Reconnect:** Listen to the Socket.IO `reconnect` event, re-fetch the endpoint, and call `hydrate()` to catch up on any missed events during the partition.

### 4. UI Representation

- `AgentColumn.tsx` must render the hydrated worker bubbles identically to live-spawned workers, including visual treatments for `paused` status.
- **DAG Visualization**: The UI SHOULD optionally group or connect workers that have declared `dependencies`, allowing users to visualize the orchestrator's multi-agent graph rather than just a flat list.
- The `AgentDrawer.tsx` slide-out inspector must function correctly for hydrated workers. When clicked, it will utilize its existing `fetchSession(agent.id)` (where `agent.id` is the `workerSessionId`) to pull the full transcript and continue its standard `shouldPollWorker` logic if the worker is active. It MUST also support resuming a `paused` worker.
- `DelegationCard.tsx` must correctly sync its state with the hydrated store.

## Acceptance criteria

1. **Cold Start Hydration:** After a hard browser refresh, workers associated with the active session populate the roster UI (`AgentColumn.tsx`) within 500ms.
2. **State Accuracy:** Running workers appear as active; recently completed workers show their respective completion statuses.
3. **Inspector Interactivity:** Clicking on a newly hydrated worker bubble successfully opens `AgentDrawer.tsx` and loads the correct transcript data.
4. **Idempotency & Merge:** Live WebSocket events arriving concurrently with or immediately after the API hydration merge cleanly. No duplicate avatar bubbles or task entries are created for the same `taskId`.
5. **Empty State Handling:** Sessions with no historically spawned workers return an empty array and do not log UI errors.
6. **Bounds Limiting:** A session with 100+ historical tasks returns a capped/paginated list (e.g., max 50), preventing unbounded growth in the dashboard.
7. **Reconnection Recovery:** Simulating a network drop and reconnecting the WebSocket correctly fetches missed completed/spawned states and updates the roster seamlessly.

## Open questions and decisions

- **Activity Snippet Overhead:** Is querying the `messages` table for `lastActivitySnippet` too expensive for the `GET /api/sessions/:sessionId/workers` endpoint? If performance degrades, we may drop the snippet or require it to be explicitly materialized in the `tasks` table.
- **Eviction Strategy:** Should the dashboard actively prune completed workers older than 30 minutes from the UI, or simply rely on the browser refresh/reconnect to cull them? *Decision deferred: currently rely on reconnect/refresh to apply the cap.*
