---
summary: Architecture invariants, extension guardrails, and clearly labeled historical target proposals for Agent Harness.
read_when:
  - Changing runtime behavior, package boundaries, persistence, plugins, sessions, or lifecycle hooks.
  - Evaluating whether a proposed design conflicts with an adopted decision.
---

# Architecture Decisions

This document captures the design decisions behind agent-harness. It is written for AI agents and human contributors who need to understand *why* the system is built this way, not just *what* exists.

Implementation details change. This document describes **invariants, patterns, and intent**, not implementation status. Read [`architecture/CURRENT_STATE.md`](architecture/CURRENT_STATE.md) first for verified behavior. Where this document conflicts with current source, `CURRENT_STATE.md`, or an accepted ADR, the source/current-state/ADR evidence governs.

---

## 1. System Identity

Agent-harness is a **web-based multi-agent orchestration system** with a persistent split-panel dashboard. Its unique value is:

- An **orchestrator agent** that delegates tasks to **worker agents**
- A **web dashboard** where the chat interface is always visible alongside content (inbox, agents, settings)
- A **knowledge inbox** where agents deposit files for human review
- A **plugin system** that extends both server functionality and dashboard UI

It is not a general-purpose agent framework. It is a **web application** that happens to orchestrate agents. The dashboard is a first-class citizen, not an afterthought.

---

## 2. Core Invariants

These rules must always hold. If a proposed change violates one, the change is wrong.

### 2.1 The browser is the UI, the server is the brain

The dashboard runs in the browser. It does not directly access the filesystem or execute shell commands. Instead, it **instructs the server** to perform these operations via the REST API and WebSocket. The server has the same tools a CLI agent would — readFile, writeFile, editFile, runCommand, glob, grep, webFetch — and executes them on the dashboard's behalf. The only difference between agent-harness and a CLI agent is where the UI lives: a browser instead of a terminal.

### 2.2 The right panel is always chat

The right panel of the dashboard always shows the chat interface (session tabs, message stream, input). Plugins cannot replace it. Plugins can add content alongside it (widgets, status indicators) but the chat panel is sacred.

### 2.3 Plugins are server-discovered, never filesystem-scanned by the dashboard

The server is the single source of truth for what plugins exist. The dashboard fetches a plugin registry from the server on load. The dashboard never scans directories or reads plugin manifests directly. This is because the dashboard runs in the browser and does not have filesystem access.

### 2.4 Agent configs are markdown files

Agent configurations are `.md` files with YAML frontmatter. This format is human-readable, git-friendly, and editable from the dashboard. The format is stable — do not introduce binary or opaque config formats for agents.

### 2.5 The dashboard-server boundary is sacred

The dashboard communicates with the server only via:
- REST API (`/api/*` endpoints)
- WebSocket events (real-time agent lifecycle)

The dashboard never imports from `@agent-harness/server`. The server has the same tools as a CLI agent (readFile, writeFile, runCommand, etc.) and executes them on the dashboard's behalf. This separation keeps the system deployable, testable, and UI-agnostic.

### 2.6 The system is self-improving

Users must be able to improve the system from within the dashboard. This means:
- Adding new plugins via the UI
- Creating and editing agent configs via the UI
- Modifying settings via the UI
- Plugins can extend the UI to add more self-improvement capabilities

The system should be able to bootstrap its own extensions. A user should never need to edit source code to add a new capability — the dashboard provides the interface for growth.

---

## 3. Extension Points

These are the official ways to extend the system. When adding new functionality, use these extension points rather than creating ad-hoc mechanisms.

### 3.1 Plugins (server + dashboard)

Plugins are the primary extension mechanism. A plugin can provide:

| Extension | What it adds | Where it appears |
|---|---|---|
| **Pages** | New left-panel views | Left panel, accessible via nav |
| **Nav items** | Navigation entries | Top navigation bar |
| **Command palette commands** | Options in the global command palette | Command palette (Ctrl+K, global overlay) |
| **Inbox renderers** | Renderers for new file types | Inbox item detail view |
| **Chat cards** | Custom event card components | Chat message stream |
| **Settings panels** | Configuration UI sections | Settings page (new tab/section) |
| **Tools** | Agent-callable tools | Registered in ToolRegistry |

**Command palette commands are declarative.** A plugin registers commands in its manifest with a `navigate` action (route push) or a `builtin` action that triggers a built-in command by id. Manifests never carry executable code, and the dashboard only accepts a small, validated set of action types and icon names. A command that needs custom behavior is deferred until plugin components can be loaded on demand (the inbox-renderer pattern).

### 3.2 Tools (core package)

Tools are agent-callable functions. Adding a new tool:
1. Create the tool in `packages/core/src/tool/`
2. Implement the `Tool` interface (name, description, Zod parameters, execute function)
3. Export from core package
4. Register in the tool registry when creating agents

Tools are the most stable extension point. The `Tool` interface rarely changes.

### 3.3 Agent configs (runtime)

Agent behavior is defined by `.md` files with YAML frontmatter. New agents can be:
- Created from the dashboard UI
- Edited from the dashboard UI
- Added as files in the `agents/` directory

Agent configs are loaded at runtime, not compile time. Adding a new agent does not require a rebuild.

### 3.4 Server routes

New API endpoints are added by:
1. Creating a route file in `packages/server/src/routes/`
2. Mounting it in the server's `index.ts`
3. Adding a client function in `packages/dashboard/src/lib/api.ts`

This is a manual process — there is no route auto-discovery. This is intentional: routes are stable API contracts and should be explicitly registered.

---

## 4. Design Decisions

### Why a web dashboard instead of a CLI/TTY?

Agent-harness targets users who need **visibility** into multi-agent work. A web dashboard provides:
- Persistent split view (chat always visible alongside content)
- Rich rendering for inbox artifacts (PDFs, diagrams, tables)
- Real-time updates via WebSocket without terminal rendering overhead
- Accessibility from any device on the network

The server has the same capabilities as a CLI agent (file operations, shell commands, web fetching). The browser is just a different UI for the same underlying system.

### Why server-driven plugin discovery instead of build-time or filesystem scanning?

The dashboard runs in the browser. It cannot:
- Read the filesystem
- Import arbitrary modules at runtime
- Scan directories for plugins

The server can do all of these. So the server is the registry, and the dashboard is a consumer. This also means:
- Plugin changes are reflected without rebuilding the dashboard
- The server can filter/validate plugins before exposing them
- The dashboard stays a clean client with no server-side concerns

### Why bundled plugins instead of external npm packages?

Deployment simplicity. Plugins ship with the application. There is no:
- Runtime `npm install` complexity
- Version compatibility matrix
- Network dependency for plugin installation
- Security surface area from arbitrary npm packages

The tradeoff is that adding a new plugin requires a rebuild of the dashboard. This is acceptable because plugins are long-lived extensions, not throwaway scripts.

### Why Zustand for state management?

Zustand provides:
- Minimal boilerplate (no actions/reducers/providers)
- Direct state access without selectors causing re-renders
- Simple subscription model for WebSocket integration
- Small bundle size

The tradeoff is less structure than Redux. This is acceptable because the dashboard's state is relatively flat: sessions, inbox items, plugins, settings.

### Why separate packages (core, server, dashboard)?

Clear separation of concerns:
- **core**: Pure TypeScript, no HTTP or UI dependencies. Testable in isolation.
- **server**: HTTP layer. Depends on core. No UI concerns.
- **dashboard**: UI layer. Depends on core. No server internals.

This enables:
- Testing core logic without starting a server
- Swapping the dashboard (e.g., a desktop app) without changing core
- Multiple server implementations (e.g., a CLI server for testing)

### Why markdown for agent configs?

- Human-readable and git-friendly
- Editable from the dashboard ( Monaco editor support)
- YAML frontmatter is a stable, well-understood format
- The markdown body becomes the agent's instructions — natural for LLM prompts
- No binary format, no schema migration headaches

### Why a self-improving system?

The system's value grows with its capabilities. If improving the system requires editing source code, the barrier to improvement is high. By making the dashboard the interface for adding plugins, creating agents, and modifying settings, the system becomes its own on-ramp for growth. Users improve the system by using it.

---

## 5. Deferred capability proposals

Earlier design work proposed runtime skills, prompt templates, session branching, compaction, product context-file loading, plugin hot reload, and multi-provider registration. Multi-provider routing and capability-aware execution are now adopted and implemented. Conversation compaction is also implemented and governed by [`specs/conversation-compaction/SPEC.md`](../specs/conversation-compaction/SPEC.md); the remaining items in this section are still deferred proposals.

These ideas require separate specifications and decisions after the identity/recovery phase. In particular:

- `.agents/skills/` contains development workflows only;
- a root product `skills/` directory or loader is prohibited by [ADR 0001](decisions/0001-development-agent-layer.md) until a runtime spec, ontology, security model, persistence design, and ADR authorize it;
- compaction records describe derived model context only: canonical transcript messages are never deleted or rewritten, ranges may not overlap, and summary usage is accounted separately from primary generation;
- the current server has no prompt-template, branching, context-file, or plugin-watcher implementation;
- provider routing uses the server-owned registry and runtime policy adopted by [ADR 0006](decisions/0006-server-owned-provider-runtime.md); capability discovery follows the same opaque provider/model target and never makes a model-name prefix own configured routing.

See [`architecture/TARGET_DIRECTION.md`](architecture/TARGET_DIRECTION.md) for directional constraints and [`architecture/RUNTIME_ONTOLOGY.md`](architecture/RUNTIME_ONTOLOGY.md) for the vocabulary that future identity and recovery designs should use.

---

## 6. Anti-Patterns

These are things that must never be done, even if they seem convenient.

### Never hardcode renderer dispatch

The inbox renderer dispatch must go through the plugin store and component registry. Do not add `if (type === 'x') return <XRenderer />` chains in `InboxItemView.tsx`. Register a component key in `packages/dashboard/src/plugins/registry.ts` and declare extensions in a manifest.

### Never import plugin components directly

Built-in renderer components are currently registered statically in one component registry; arbitrary dynamic plugin code loading is not implemented. Do not import renderer components directly into dashboard pages or imply that manifest discovery grants code-execution permission.

### Never add routes by editing layout.tsx

Page and navigation plugins are not implemented by the current manifest schema. Adding that surface requires a dedicated schema, trust, loading, and routing design; do not add an unsupported `navItems` field and present it as functional.

### Never bypass the server API

The dashboard must not import from `@agent-harness/server`. All file operations, shell commands, and agent executions go through the REST API and WebSocket. The server is the single execution layer — the dashboard is the presentation layer.

### Never hardcode tool registration

Tools are registered dynamically based on agent configs. Do not hardcode tool lists in the chat route. Read the agent's `tools` array and register accordingly.

### Never skip the plugin manifest

Plugins must declare their capabilities in `manifest.json`. Do not create "implicit" plugins that register via code alone. The manifest is what the server reads to build the registry.

---

## 7. Adding New Features

Use this decision tree when adding something new.

### I want to add a new inbox file type

1. Create a plugin directory in `packages/dashboard/src/plugins/`
2. Add a `manifest.json` with `inboxRenderers` entry
3. Create the renderer component
4. The server picks up the manifest, dashboard fetches the registry
5. `InboxItemView` dispatches to your renderer via the plugin store

### I want to add a new chat event type

1. Create a plugin with `chatCards` in its manifest
2. Create the card component
3. The server emits the event type via WebSocket
4. `ChatStream` renders your card via the plugin store

### I want to add a new agent tool

1. Create the tool in `packages/core/src/tool/`
2. Implement the `Tool` interface
3. Export from core's `index.ts`
4. Register the tool in the tool registry (server's chat route or agent config)

### I want to add a new settings section

1. Create a plugin with `settingsPanels` in its manifest
2. Create the settings panel component
3. The settings page renders your panel via the plugin store

### I want to add a new page to the dashboard

1. Create a plugin with `pages` in its manifest
2. Create the page component
3. Add a `navItems` entry for navigation
4. The layout renders your nav link, the router displays your page

### I want to add a new server API endpoint

1. Create a route file in `packages/server/src/routes/`
2. Mount it in the server's `index.ts`
3. Add a client function in `packages/dashboard/src/lib/api.ts`
4. Use the client function from dashboard components

### I want to add a new agent type

1. Create a `.md` file in `agents/` (or via the dashboard UI)
2. Define frontmatter (name, model, tools, maxSteps)
3. Write instructions in the markdown body
4. The orchestrator can now delegate to this agent

### I want to improve the system itself

1. Identify what capability is missing
2. Determine if it should be a plugin, tool, or core change
3. If it's UI-extensible: create a plugin
4. If it's agent-extensible: create a tool or agent config
5. If it's a core capability: modify the core package
6. The dashboard can be used to create the agent configs and plugins needed

---

## 8. File Structure Reference

```
agent-harness/
├── packages/
│   ├── core/           # Pure TypeScript: agents, tools, capabilities, persistence
│   ├── server/         # Express + WebSocket: REST API, tool execution, real-time events
│   └── dashboard/      # Next.js: browser UI with split panel layout
│       └── src/
│           ├── plugins/        # Plugin directory (bundled, server-discovered)
│           │   ├── _built-in/  # Migrated from hardcoded components
│           │   └── [user]/     # User-created plugins
│           ├── components/     # Core UI components
│           ├── stores/         # Zustand state management
│           └── lib/            # API client, utilities
├── agents/             # Agent config .md files (runtime-loaded)
├── inbox/              # Knowledge inbox artifacts
├── sessions/           # Session transcripts (JSON)
└── .harness/           # Runtime data (capabilities cache, settings, plugin registry)
```

---

## 9. Technology Choices

| Choice | Why |
|---|---|
| **TypeScript** | End-to-end type safety across core, server, dashboard |
| **Next.js 14 (App Router)** | File-based routing, React Server Components, streaming |
| **Express** | Simple, well-understood HTTP framework |
| **Socket.IO** | Real-time WebSocket with fallback support |
| **Zustand** | Minimal state management, no boilerplate |
| **Tailwind CSS** | Utility-first styling, consistent design system |
| **Vercel AI SDK** | Provider abstraction for LLM APIs |
| **Turborepo** | Monorepo build orchestration |
| **Zod** | Runtime schema validation for tool parameters and configs |
| **gray-matter** | YAML frontmatter parsing for agent configs |

---

## 10. Message Delivery and Session-to-Session Communication

This section defines how work and results flow between sessions, agents, and the user. It pins down a delivery model that must hold as the system grows.

### 10.1 Delivery is the system's job, never the agent's

An agent must never poll for status. Checking "are my workers done?" via a tool call burns tokens on bookkeeping and couples the agent to the runtime's scheduling. Instead, the system owns delivery:

- When a worker (or another session) produces a result, the **system** enqueues it for the target session.
- While a session is running, the runtime drains its incoming messages at each loop boundary and injects them into the agent's context as system messages.
- The agent only acts on what it is given. It never spends a tool call asking "anything new?"

This is a hard invariant: there is no agent-facing "check inbox" tool.

### 10.2 Sessions are addressable runtime units with durable mailboxes

A session is not just a transcript file. It is an addressable unit with:

- **A durable mailbox** — an ordered, persisted queue of incoming messages (user messages, worker completions, session-to-session messages).
- **A runtime** — the in-memory execution context (agent config, message history, busy state) that processes the mailbox.

Any sender — user, worker, or another session — posts to a session's mailbox. Senders never talk to an agent directly.

### 10.3 The loaded gate

A session's mailbox is drained **only when the session is loaded** — that is, when its runtime is alive in the server. This is the single rule governing delivery:

- **Loaded session:** incoming messages are enqueued and the runtime is signaled. If the session is not currently running, it is woken to process. An open, idle session can therefore be given work and will act on it.
- **Not-loaded session:** incoming messages accumulate in the durable mailbox, untouched and unprocessed. When the session is loaded later, it drains the mailbox in order.

The distinction is loaded vs. not-loaded, **not** idle vs. running. "Idle" must never prevent a loaded session from receiving and acting on work.

### 10.4 Session-to-session communication

Orchestration is not limited to an orchestrator spawning delegates. A session can spawn other sessions, and any session can post to any other session's mailbox. Multi-level orchestration is the natural result: an orchestrating session spins up sessions, those sessions run their own delegated agents, and results report back by posting to the orchestrator's mailbox. Whether a posted message triggers work depends only on the target's loaded state (10.3).

### 10.5 Runtime and manager

The server keeps:

- **`SessionRuntime`** — owns an agent's config, history, mailbox, and a serialized `process()` (one run at a time; messages arriving mid-run queue until the current run yields).
- **`SessionManager`** — a registry of loaded runtimes; routes messages to the correct session; loads a session when opened and unloads it (keeping the durable mailbox) when appropriate.

The chat route becomes "enqueue a message and signal the runtime" rather than a synchronous full run. The runtime emits WebSocket events so the UI stays live.

### 10.6 Worker completion delivery

When a worker completes, the system posts the result to the delegating session's mailbox (summary + status + task id; the full transcript remains available on demand via `readSession`). If that session is loaded, its runtime wakes and processes; if not, the result persists until the session is loaded. The agent never polls for this.

### 10.7 Durable storage — the single-writer rule

One piece of code owns all session file I/O. No caller writes files directly; callers submit full-state snapshots through the store, and the store is the only thing that touches disk.

- **Per-session write queue:** writes to a given session file are serialized — only one write in flight per session at a time. Different sessions write in parallel; the same session never overlaps.
- **Full-state snapshots:** every queued write is the complete session state (transcript, result, pending mailbox), never a delta.
- **Atomic writes:** write to a temp file, then rename over the target, so a crash mid-write can never leave a truncated file.
- **Immediate flush, whole-queue drain:** there is no artificial debounce or wait for more writes. A write triggers an immediate flush. When the flush runs, it drains *everything* queued for that file at that moment in one operation. One queued write → one disk write. Five queued writes → one disk write containing all five (because each is a full snapshot, the newest snapshot is the merged result). N writes never become N disk writes when they could be one.
- **Debounce is a transcript-only refinement:** an agent doing continuous work writes the transcript constantly. Where that bursts, writes to the *transcript* may be debounced and coalesced to the latest snapshot to bound disk I/O. Debounce and coalescing never apply to mailbox messages.

### 10.8 Two stores, two durability profiles

Durable state has two distinct halves with different requirements. They are often conflated; they must be treated separately.

- **Session transcript** (the conversation stream): written continuously during a run. Correct semantics are latest-state-wins — coalesce and debounce are safe, and a crash loses only the unwritten tail since the last flush.
- **Inter-agent mailbox** (the delivery queue): discrete, individually meaningful messages (worker completions, session-to-session messages). Semantics are **lossless and ordered**. Messages are never coalesced, never collapsed, and never dribbled out one at a time. A message is removed only once it has actually been delivered (acked) by the consuming runtime.

The two may live in the same session file under the same single-writer mechanism — the snapshot includes the pending-mailbox array, so coalescing the transcript to the latest snapshot still preserves every undelivered message. Removal from the mailbox is tied to delivery, never to the write itself. Where stronger mailbox guarantees are wanted, it can be kept as a separate append-only log committed independently of the transcript snapshot.

### 10.9 Mailbox delivery — atomic batch drain

When a session's runtime processes, it drains the **entire** mailbox at once and delivers all pending messages to the agent **together in a single injection** — never one at a time.

- The agent sees the complete set of pending messages before it makes its next decision. Partial information is a correctness failure: three worker completions may each be required for the agent to do its work.
- The drain is all-or-nothing: either the whole batch is delivered and the mailbox is cleared, or (if interrupted) nothing is cleared. There is never a partial drain.
- Messages arriving while a run is in progress accumulate and are drained wholesale at the next loop boundary — same rule, all at once.

### 10.10 The wake-run guard

A run triggered by a delivered completion (no new user message) is a **wake run**. Wake runs must report results, not spawn new work: the `delegate` tool is dropped from the wake run's tool set so a woken agent presents its delivered completions instead of autonomously re-delegating. Worker configs also omit `delegate`; recursive delegation is not implemented and needs a separate bounded design before it can be enabled.

- Delegation is only available on **user-initiated runs** (a message was sent).
- A wake run with nothing to report returns immediately without calling the LLM.
- This is a hard rule, not a prompt instruction — the tool is absent, so the model cannot call it.

---

## 11. Agent Transparency and the Audit Record

The user must be able to trust the agent by reading *what it did and why*. This section pins down how the system records and discloses agent behavior.

### 11.1 The transcript is the complete audit record

Every run persists the **full message sequence** — the user prompt, each assistant message with its tool calls and reasoning, every tool result, and the final answer — for the main session **and** worker sessions alike. A run is never collapsed to a summary in storage.

- The agent's action trail (tool call → result → next decision → answer) is exactly what the user reads to understand the agent's path.
- Persistence and *display* are separate concerns: what is stored is always the complete record.

### 11.2 Store bytes exactly as produced; truncate only at display

Storage never scrubs, summarizes, collapses, or rewrites message content. Whatever the model or a tool produced is written verbatim — including raw tool results, which can be large.

- Display may truncate for readability, but **everything truncated is expandable**: the user clicks to reveal the full content. No information is unreachable in the UI.
- Do not "clean" or strip content at write or load time as a shortcut for display concerns. If content must be altered for a specific renderer, do it at render time.

### 11.3 Tool calls are structured data, not text

A tool call is structured fields (`toolCallId`, `toolName`, `args`) — never embedded as text in the message content. The UI renders tool calls as structured blocks and derives a human-readable hint from the **name and actual args** (e.g. `webFetch → url=https://…`).

- There is **no model-written "purpose" field** per tool call. Asking the model to restate why it called a tool adds output tokens on every call, carries a format-reliability risk, and duplicates what reasoning already provides. The "why" comes from the persisted reasoning that precedes the call (11.4), and the "what" comes from the args.

### 11.4 Reasoning is part of the record but never re-fed

Where the provider exposes chain-of-thought (`reasoning`), it is stored with the assistant message. It is never re-sent to the model on later runs: the LLM-context assembly path strips reasoning and system roles when building the next request.

- The record is for humans to inspect; the model's future context stays clean.
- Reasoning is shown collapsed and expandable in the UI, in the same assistant turn as the tool calls it produced.

### 11.5 Live progress streaming

The runtime emits session updates **as work progresses, not only at completion**. After each LLM turn the current message state is emitted, so the chat fills in step-by-step — reasoning, then tool call, then result — instead of everything arriving at once when the run finishes.

- Live updates are a *disclosure* concern: the persisted record is the same whether or not the UI was watching.

### 11.6 Workers are as observable as the orchestrator

A delegated worker is no less transparent than the main agent:

- Worker tool activity is emitted live to the same WebSocket channel.
- The worker transcript is **progressively persisted** during the run (not only at completion), so its drawer/view updates as it works and survives a mid-run crash.
- The worker's full transcript remains available on demand via `readSession` after completion.

---

## 12. Session Lifecycle and Open-Session State

A session's transcript is durable (10.7). Its open/closed state in the dashboard is a separate, much smaller piece of state that must also survive restarts — otherwise a reopened app shows an empty tab bar despite all sessions being on disk.

### 12.1 The open set is durable, server-owned state

The set of open sessions (and which is active) is persisted by the server, not held ephemerally in the browser. It survives browser reloads, incognito sessions, and different devices pointed at the same server.

- The dashboard submits its open set as a whole snapshot; the server persists it. One writer, full-state snapshots — the same discipline as 10.7.
- On boot the dashboard restores the recorded open set. Sessions that no longer exist are dropped silently.

### 12.2 Closed is not deleted

Closing a session removes it from the open set only. The session file is untouched and the session remains fully recoverable.

- **Deletion is an explicit, separate, destructive action.** No routine lifecycle step may erase a session transcript.
- The set of closed sessions is always discoverable, so reopening is possible at any time. Closing is reversible; deletion is not.

### 12.3 Boot restores the layout, never the runtimes

Restoring the open set on boot renders history from the persisted transcript. It does not load runtimes, drain mailboxes, or spend tokens.

### 12.4 Opening is a delivery decision, not a display decision

Opening a session (a deliberate act: creating one or reopening a closed one) decides delivery, per the loaded gate (10.3, 10.5):

- If the durable mailbox holds undelivered messages, opening loads the runtime and wakes it — the mailbox drains and results are reported (10.9, 10.10).
- If the mailbox is empty, opening renders history only. No runtime is created.

### 12.5 Worker sessions are not part of the open set

Auto-spawned worker sessions belong to their delegating session's lifecycle. They are never surfaced as independent open tabs.

### 12.6 A derived metadata index powers listing and search

Listing, titling, and searching sessions must not read every transcript (10.7). A derived metadata index — a projection of each top-level session (title, agent, prompt, timestamps, message count) — is maintained by the same single writer as the transcripts.

- Its durability profile is deliberately weaker than transcript or mailbox (10.8): **eventually consistent, coalesced, and rebuildable** from the transcripts when the index file is missing or corrupt. It is a cache, never a source of truth.
- Worker sessions are excluded (12.5).
- The write path sits behind a small interface so the index can later be swapped for a real query engine (e.g. SQL) without touching transcripts or routes.

### 12.7 Sessions are nameable

A session has an optional title. The title is part of the session record — the durable source of truth — not the registry (12.1) or a side table. It survives closing, reopening, and restarts, and flows to every listing (tab bar, command palette, reopen modal) through the index (12.6).

---

## 13. Lifecycle Hooks

The system exposes lifecycle events so external functionality can react to — or gate — core actions. This is a pattern baked into the system's events, not a one-off for one feature. Consumers are built-in modules and, later, plugins.

### 13.1 Two families: before-middleware and after-observers

Every lifecycle event is defined once, up front, as one of two families. A hook subscribes to an event and inherits that event's semantics — a hook never declares its own blocking behavior.

- **Before-middleware** runs *before* an action commits, **in registration order**, and is **awaited by definition**. Each piece may **mutate** the event's payload — the payload is a typed shape and mutation is validated — and may **veto** the action by throwing, in which case the action does not happen. This is the pre-commit-hook model: the action literally cannot complete until every middleware has passed. A piece that only vetoes without mutating is a *guard*; one that shapes the payload is an *interceptor* — the same mechanism, two behaviors. Order is meaningful here because middleware builds on the previous step's mutation.
- **After-observers** run *after* an action commits and are **fire-and-forget by definition** — the action never waits for them. Errors are logged and isolated: a failing observer never changes the action's outcome and never affects other observers.

### 13.2 Waiting is a property of the event, never of the hook

A hook cannot choose to block or not block the action. Before-middleware blocks; after-observers don't. This makes misuse impossible: an observer cannot accidentally stall the system, and a middleware cannot accidentally skip its gate.

- "React to an action" → subscribe to the after-event.
- "Gate or shape an action" → subscribe to the before-event.

### 13.3 After-observers: serialized by default, parallel when opted in

After-observers do not form a pipeline — each independently reacts to the same event, and one's output is never passed to the next. They are nonetheless **serialized in registration order by default**. This is a race-safety measure for observers that touch shared resources (e.g., two observers appending to the same learnings store), never a semantic precedence contract. If one observer genuinely depends on another's work, that is a signal to compose them into a single handler or read the source of truth — not to rely on ordering.

An observer may opt into **immediate parallel execution**: it is then fired concurrently, bypassing the queue, and neither waits for nor is waited on by other observers. Opting in is a declaration by the observer author that the work is independent and race-safe. Both modes remain fire-and-forget — the action never waits for any observer.

### 13.4 Initial events

Session lifecycle events are hookable: opened, closed, created, deleted, renamed. Middleware exists where gating or shaping is meaningful (before-close, before-delete). The set grows as the app's events grow; the two-family contract is fixed.

---

*This document should be updated when a new design decision is made that affects how the system is built. Implementation details belong in code comments and README files — not here.*
