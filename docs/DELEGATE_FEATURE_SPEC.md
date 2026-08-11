---
summary: Behavioral specification and phased implementation record for agent selection, delegation, delivery, and worker visibility.
read_when:
  - Changing delegation, worker sessions, completion delivery, cancellation, or agent-scope UI.
  - Verifying which delegate-feature phases are implemented or deferred.
---

# Delegate Feature Spec

Status: Draft
Branch: `feat/delegate`
Author: Damain Joseph

This spec captures the entire delegate feature as decided in the design sessions. It is grounded in `ARCHITECTURE_DECISIONS.md` §10 (Message Delivery and Session-to-Session Communication) and extends it with the agent-selection and agent-scope UI decisions. It defines the target system, the API/data contracts, and a phased implementation plan.

---

## 1. Overview

Today the app runs a single-agent chat loop. Multi-agent machinery (`Orchestrator`, `Worker`, `Council`, `MessageBus`) exists in `core` but is **not wired into the chat path**. This feature makes delegation real:

- Any agent whose config declares delegation tools can **delegate work to worker agents**.
- Results are **delivered by the system** (never polled by the agent).
- Agents are **selectable and discoverable** from the chat.
- Agent activity is surfaced in a persistent **agent-scope UI** to the left of the chat.

The defining property: an agent is an *orchestrator if and only if it holds the delegation tools* — the role is a capability, not a name.

## 2. Design decisions this is built on

| # | Decision | Source |
|---|---|---|
| D1 | Delivery is the system's job; no agent polling; no agent-facing "check inbox" tool | ADR §10.1 |
| D2 | Sessions are addressable runtime units with durable mailboxes | ADR §10.2 |
| D3 | A session's mailbox is drained only when the session is **loaded** | ADR §10.3 |
| D4 | Any session can post to any other session's mailbox (session-to-session) | ADR §10.4 |
| D5 | `SessionRuntime` + `SessionManager` on the server; runtime emits WebSocket events | ADR §10.5 |
| D6 | Worker completions are posted to the delegating session's mailbox | ADR §10.6 |
| D7 | Durable storage: single-writer, full-state snapshots, atomic writes, immediate flush with whole-queue drain | ADR §10.7 |
| D8 | Two stores (transcript vs mailbox) with different durability profiles; mailbox is lossless/ordered, never coalesced | ADR §10.8 |
| D9 | Mailbox drains atomically — the entire batch delivered together in one injection | ADR §10.9 |
| D10 | Agents are selected per-session; agent picker in chat; `description` for discoverability | session decisions |
| D11 | Agent-scope UI: bubble column anchored to chat's left edge; sliding drawer over the left panel | session decisions |
| D12 | Wake runs (completion-delivered, no user message) drop the `delegate` tool so the agent reports results instead of re-delegating | ADR §10.10 |
| D13 | The transcript is the complete audit record: full message sequence (tool calls, tool results, reasoning) persisted for main and worker sessions | ADR §11.1 |
| D14 | Store bytes exactly as produced; truncate only at display; everything truncated is expandable | ADR §11.2 |
| D15 | Tool calls are structured data (id, name, args); no model-written "purpose" field | ADR §11.3 |
| D16 | Reasoning is stored with the message but never re-fed into the LLM context | ADR §11.4 |
| D17 | Runtime emits live session updates as work progresses, not only at completion | ADR §11.5 |
| D18 | Workers are as observable as the orchestrator: live tool events + progressively persisted transcript | ADR §11.6 |

## 3. Agent model

- Agent configs remain `.md` files with YAML frontmatter (`agents/*.md`).
- **Delegation capability is declarative:** adding `delegate` (and optionally `readSession`) to an agent's `tools` array makes it an orchestrator. No class or hardcoded name decides this.
- **Multiple orchestrators are allowed.** Recursive delegation is structurally possible (a worker inherits the delegator's tools), though not the primary operating mode.
- Add an optional `description` field to agent frontmatter (`AgentConfig.description`), used by the picker to show each agent's purpose. Fall back to the first sentence of `instructions` when absent.

## 4. Agent selection in chat

- Each session has an `agentName` (default `orchestrator`).
- A picker lives in the chat header (session bar): shows the current agent, lists all configured agents with name + description (+ derived Orchestrator/Worker badge when delegation tools are present).
- Selecting an agent sets it for the active session; `agentName` is persisted on the session server-side.
- `POST /api/chat` carries `agentName`; the server loads that config (validated, fallback to orchestrator).

## 5. Delivery model (target)

1. An agent calls `delegate({ task, model? })`. `model` is optional: when omitted, the worker **inherits the delegating agent's model** (guaranteed supported since that agent is running on it). The system creates a **worker session** (`worker-<taskId>`), spawns a `Worker` in the background, and returns the `taskId` immediately (fire-and-forget).
2. When the worker completes (success or error), the **system posts a completion message to the delegating session's mailbox** — summary + status + taskId (+ sender). The agent does not poll.
3. The mailbox is **durable** (persisted with the session).
4. When the delegating session next processes (a new message arrives, or its loaded runtime is signaled), the runtime **drains the entire mailbox at once** and injects all pending messages **together** into the agent's context before the next LLM call.
5. The agent sees, e.g.: *"Worker `worker-<id>` (task you delegated) completed: done. Summary: … You may call `readSession(<taskId>)` for the full transcript."*
6. Full transcripts remain available on demand via the `readSession` tool.

Phase 1 simplifies step 4: the mailbox is drained at the start of the next run triggered by a user message (no wake-on-idle yet). Phases 2+ add `SessionRuntime` wake-on-signal, WebSocket events, and the live UI.

## 6. Durable storage (target)

See ADR §10.7–10.9. Summary:

- **Single writer:** one code path owns all session file I/O; callers submit full-state snapshots.
- **Per-session write queue:** serialized writes per session file; different sessions write in parallel.
- **Atomic writes:** temp file + rename.
- **Immediate flush, whole-queue drain:** no debounce by default; when a flush runs it writes everything queued for that file in one operation. Debounce/coalesce is transcript-only.
- **Two stores:** the transcript (latest-state-wins) and the mailbox (lossless, ordered, never coalesced, removal tied to delivery).
- Both may live in one session file under the same writer; the mailbox may alternatively be a separate append-only log.

## 7. Agent-scope UI

### 7.1 Bubble column

- A vertical column **anchored to the left edge of the chat panel** (inside `RightPanel`). It moves with the chat when the panel is resized.
- Each entry is a **circular bubble** showing the agent's **initial**.
- The roster is the current session's agents: the session's primary agent always present, plus sub-agents as they are spawned.
- Bubbles **animate in one at a time** with a slight staggered delay.

### 7.2 Delegate drawer

- Clicking a bubble opens the **delegate drawer** for that agent.
- It **slides out from beneath the chat and extends leftward**, overlaying the left-panel area (inbox / agents / settings / plugins). Think of a sheet of paper pulled out from under the chat. Its right edge tucks under the chat's left edge.
- **Drag-resizable** to any width.
- **Two snap buttons at the top:** *default* width and *max* width (the full available space to the left of the chat).
- **Close button (X)** at the top; closing retracts the drawer back under the chat.
- The drawer's width is **persisted in `sessionStorage`** and restored on reopen.
- Content: the agent's behind-the-scenes work — delegated tasks, status (running/idle/done), tool calls, messages, timestamps, results.
- All animations are deliberate: drawer slides, bubbles stagger, drawer opens/closes smoothly.

## 8. Data contracts

### 8.1 Session file (`sessions/<id>.json`)

```ts
interface PendingMessage {
  taskId: string;
  from: string;            // worker session id
  agentName: string;       // worker agent name
  status: "done" | "error";
  summary: string;
  receivedAt: string;      // ISO
}

interface SessionData {
  sessionId: string;
  taskId: string;
  agentName: string;            // NEW — the session's agent
  prompt: string;
  messages: Message[];
  mailbox: PendingMessage[];    // NEW — durable delivery queue
  result?: { status: string; summary: string };
  createdAt: string;
  completedAt?: string;
}
```

### 8.2 Agent config

```yaml
name: orchestrator
model: DEFAULT
description: Coordinates work by delegating to specialized workers  # NEW (optional)
tools:
  - readFile
  - writeFile
  - delegate       # NEW — declares orchestration capability
  - readSession    # NEW — fetch a worker's full transcript
  - ...
maxSteps: 50
```

### 8.3 REST

```
POST /api/chat
  body: { sessionId, message, agentName? }   # agentName NEW
GET  /api/agents                              # returns description too
```

### 8.4 WebSocket (Phases 2+)

```
agent:started        # existing
agent:completed      # existing
agent:error          # existing
worker:spawned       # NEW — a worker session was created
worker:completed     # NEW — a worker posted to the mailbox
tool:called          # NEW — agent invoked a tool (for live drawer)
```

## 9. Implementation phases

### Phase 1 — Core delegation + agent selection (this branch's first milestone)
- `AgentConfig.description` + frontmatter schema.
- `POST /api/chat` accepts `agentName`; loads that config with fallback.
- Tool-driven delegation: register `delegate` + `readSession` only when the config declares them.
- `delegate`: creates worker session, spawns `Worker`, returns taskId.
- Worker completion → system appends `PendingMessage` to the delegating session's durable mailbox.
- On the next run, drain the mailbox **atomically** and inject all messages together into context. No `checkInbox` tool (removed/never added).
- Update `agents/orchestrator.md` to declare `delegate`/`readSession`.
- Dashboard: `agents-store`, `AgentPicker` in the session bar, per-session `agentName`, `sendMessage(..., agentName)`.

### Phase 2 — Session runtime + real-time delivery ✅ (implemented)
- `SessionRuntime` (serialized `process()`, own mailbox) + `SessionManager` (loaded registry, routing).
- Loaded-gate: drained only when loaded; not-loaded sessions persist mailbox untouched.
- Wake-on-signal for loaded sessions; WebSocket client on the dashboard; server emits `worker:*` / `tool:*` / `session:updated` events.
- Tool-driven delegation is now the single path (the old `Orchestrator` class is superseded by `SessionRuntime` + `createDelegateTool`).
- Worker completions are delivered into a loaded session automatically, and the chat UI syncs via `session:updated` (rendering completion cards from `meta` on system messages).
- **Wake-run guard:** a wake (no user message) drops the `delegate` tool, so a woken agent reports its delivered results rather than spawning new work. This bounds runaway autonomous re-delegation; delegation is only available on user-initiated runs.
- **Worker cancellation:** each spawned worker carries an `AbortController` registered by the server. `POST /api/workers/:taskId/cancel` aborts it; the agent loop checks the signal between steps and mid-LLM-call, and the worker records a `cancelled` status back to its session and the delegator's mailbox. The drawer shows a Stop button on running workers.

### Phase 3 — Agent-scope UI ✅ (implemented)
- Bubble column anchored to the chat's left edge (moves with panel resize, staggered pop-in animation).
- Delegate drawer: slides out from under the chat over the left panel; drag-resize; snap buttons (default / max); X close; width persisted in `sessionStorage` and restored on reopen.
- Drawer content per agent: status, task (workers), live tool-activity feed (from `agent:tool` events), full worker transcript (fetched via `GET /api/sessions/:id`), and the primary's delegated-work list.
- Completion cards render from real events via `session:updated` (system messages carry `meta`), lighting up the previously-dormant `DelegationCard` UI.

### Phase 4 — Durable storage hardening
- Single-writer `SessionStore` with per-session write queue, atomic writes, whole-queue drain.
- Optional separate append-only mailbox log.

## 10. Non-goals (for Phase 1)

- Councils (multi-agent chat) remain un-wired.
- Session branching and compaction (§5 of the ADR) remain future work.
- Live wake-on-idle processing and the WebSocket UI are Phase 2/3.
- No unbounded delegation: a max delegation depth / worker cap will be added with the runtime (Phase 2).

## 11. Acceptance criteria (Phase 1)

1. A user can pick any configured agent for a session; the picker shows each agent's name + description.
2. `POST /api/chat` with a different `agentName` runs that agent's config (different system prompt / tools).
3. The orchestrator (declaring `delegate`) can delegate; a worker session file is created and the worker executes.
4. On worker completion, the delegating session's `mailbox` receives the completion (durable).
5. The next message to the orchestrator delivers all pending completions together as context; the agent does not call a "check inbox" tool.
6. `typecheck` passes for all packages.
