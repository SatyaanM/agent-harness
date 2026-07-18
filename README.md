# Agent Harness

A TypeScript multi-agent orchestration harness with a web dashboard for managing AI agent collaborations.

## Overview

Agent Harness enables an orchestrator agent to delegate tasks to worker agents, coordinate via councils (ephemeral group chats), and expose a knowledge inbox for human-facing output.

**Key Features:**
- **Multi-agent orchestration** — Orchestrator delegates tasks to specialized workers
- **Persistent split dashboard** — Chat sessions always visible alongside content
- **Knowledge inbox** — Agents deposit files (reports, diagrams, data) for user review
- **4-tier capability discovery** — Dynamic model capability detection (manual → cache → models.dev → probe)
- **File-based agent config** — Define agents as `.md` files with YAML frontmatter
- **Real-time collaboration** — Councils for multi-agent deliberation

## Architecture

```
agent-harness/
├── packages/
│   ├── core/          # Harness engine (pure TypeScript library)
│   ├── server/        # HTTP + WebSocket API (Express + socket.io)
│   └── dashboard/     # Next.js frontend (persistent split layout)
├── agents/            # File-based agent configs (*.md)
├── .harness/          # Runtime data (capabilities cache, settings)
├── sessions/          # Session transcripts
└── inbox/             # Knowledge inbox files
```

### Dashboard Layout

```
┌───────────────────────────────┬──────────────────────────────────┐
│     LEFT PANEL                │     RIGHT PANEL (expanded)       │
│   (route-dependent)           │                                  │
│                               │  [Session 1] [Session 2] [+]    │
│   Routes:                     │  ┌──────────────────────────┐   │
│   / → inbox root              │  │   Chat stream            │   │
│   /inbox/:id → item viewer    │  │   (orchestrator msgs,    │   │
│   /agents → config manager    │  │    delegation cards,     │   │
│   /settings → settings        │  │    council activity)     │   │
│                               │  ├──────────────────────────┤   │
│                               │  │  [Input]                 │   │
│                               │  └──────────────────────────┘   │
└───────────────────────────────┴──────────────────────────────────┘
```

## Quick Start

### Prerequisites

- Node.js 18+
- npm 7+ (for workspaces)

### Installation

```bash
cd C:\Users\damai\agent-harness
npm install
```

### Configuration

Set environment variables:

```bash
# Required
export OPENCODE_API_KEY="your-api-key"

# Optional (defaults shown)
export HARNESS_ROOT="."
export INBOX_DIR="./inbox"
export SESSIONS_DIR="./sessions"
export AGENTS_DIR="./agents"
export PROVIDER_ENDPOINT="https://opencode.ai/zen/v1"
export DEFAULT_MODEL="qwen3.7-plus"
export PORT=3001
```

### Running

**Development mode** (all packages):

```bash
npm run dev
```

This starts:
- Core package in watch mode
- Server on http://localhost:3001
- Dashboard on http://localhost:3000

**Production build:**

```bash
npm run build
npm start
```

## Agent Configuration

Agents are defined as markdown files in the `agents/` directory with YAML frontmatter:

```markdown
---
name: orchestrator
model: qwen3.7-plus
tools:
  - readFile
  - writeFile
  - editFile
  - listDirectory
  - glob
  - grep
  - runCommand
  - webFetch
maxSteps: 50
---

You are the orchestrator agent. Your role is to coordinate work by delegating
tasks to specialized worker agents.
```

### Frontmatter Fields

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Agent identifier |
| `model` | string | yes | Model name |
| `tools` | string[] | yes | List of tool names |
| `maxSteps` | number | yes | Max tool-call iterations |
| `capabilities` | object | no | Manual capability overrides |
| `modelIdMapping` | string | no | Explicit models.dev ID |

### Available Tools

- `readFile` — Read file content
- `writeFile` — Create/overwrite file
- `editFile` — Targeted text replacement
- `listDirectory` — Browse directory structure
- `glob` — Find files by pattern
- `grep` — Search file contents
- `runCommand` — Execute shell commands
- `webFetch` — Fetch URL content

## Capability Discovery

The harness uses a 4-tier system to discover model capabilities:

1. **Manual override** — Agent config explicitly declares capabilities
2. **Local cache** — `.harness/capabilities.json` (from prior lookups)
3. **models.dev API** — Lazy per-model lookup from models.dev
4. **Probe** — Direct API call to test capabilities

Capabilities are cached aggressively and never hardcoded. The system adapts automatically as models change.

## API Reference

### REST Endpoints

```
POST   /api/chat                    # Send message (SSE stream)
GET    /api/sessions                # List sessions
POST   /api/sessions                # Create session
GET    /api/sessions/:id            # Get session
DELETE /api/sessions/:id            # Delete session
GET    /api/agents                  # List agent configs
POST   /api/agents                  # Create agent config
GET    /api/agents/:name            # Get agent config
PUT    /api/agents/:name            # Update agent config
DELETE /api/agents/:name            # Delete agent config
GET    /api/inbox                   # List inbox items
GET    /api/inbox/:id               # Get inbox item
PUT    /api/inbox/:id               # Update inbox item
DELETE /api/inbox/:id               # Delete inbox item
POST   /api/inbox/:id/track         # Register metadata
GET    /api/settings                # Get settings
PUT    /api/settings                # Update settings
GET    /api/health                  # Health check
```

### WebSocket Events

```
agent:started        # Agent began execution
agent:completed      # Agent finished
agent:error          # Agent encountered error
council:created      # Council formed
council:message      # Council message
council:dissolved    # Council completed
inbox:created        # Inbox item created
inbox:updated        # Inbox item modified
```

## Project Structure

### Core Package (`packages/core`)

Pure TypeScript library with no HTTP/UI dependencies:

- `agent/` — Agent, Orchestrator, Worker classes
- `capability/` — 4-tier capability registry
- `collaboration/` — MessageBus, Council, Supervision
- `tool/` — Tool implementations (readFile, writeFile, etc.)
- `llm/` — Vercel AI SDK adapter
- `persistence/` — Session storage, config loader, capability cache
- `presentation/` — Inbox manager

### Server Package (`packages/server`)

Express + socket.io HTTP server:

- `routes/` — REST API endpoints
- `ws/` — WebSocket event handlers

### Dashboard Package (`packages/dashboard`)

Next.js frontend with persistent split layout:

- `app/` — Next.js App Router pages
- `components/` — React components
  - `chat/` — Chat stream, input, session tabs, event cards
  - `inbox/` — Inbox browser, item viewer, renderers
  - `layout/` — Left/Right panels
  - `settings/` — Settings form
  - `agents/` — Agent config editor
- `stores/` — Zustand state management
- `lib/` — API client, WebSocket client

## Development

### Adding a New Tool

1. Create tool file in `packages/core/src/tool/`
2. Implement `Tool` interface with Zod schema
3. Export from `packages/core/src/index.ts`
4. Register in tool registry when creating agents

### Adding a New Renderer

1. Create renderer component in `packages/dashboard/src/components/inbox/renderers/`
2. Export from `renderers/index.ts`
3. Add to `InboxItemView.tsx` type dispatch

### Adding a New API Endpoint

1. Create route file in `packages/server/src/routes/`
2. Mount in `packages/server/src/index.ts`
3. Add client function in `packages/dashboard/src/lib/api.ts`

## Troubleshooting

### Server won't start

- Check if port 3001 is already in use
- Verify `OPENCODE_API_KEY` is set
- Check logs for error messages

### Dashboard won't connect

- Ensure server is running on port 3001
- Check browser console for CORS errors
- Verify API URL in `lib/api.ts`

### Agent execution fails

- Check agent config syntax (YAML frontmatter)
- Verify model name is valid
- Check capability registry for model support

### Capability lookup fails

- models.dev may be down — system falls back to probe
- Check `.harness/capabilities.json` for cached capabilities
- Use manual override in agent config if needed

## License

MIT

## Contributing

Contributions welcome. Please read the spec documents in `C:\Users\damai\agent-harness-spec\` for architecture details.
