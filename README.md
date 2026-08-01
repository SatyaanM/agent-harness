# Agent Harness

A TypeScript multi-agent orchestration harness with a web dashboard for managing AI agent collaborations.

An **orchestrator agent** delegates tasks to **worker agents**, coordinates them via **councils** (ephemeral group chats), and deposits the results into a **knowledge inbox** for you to review. Everything runs through a persistent split-panel dashboard.

## Features

- **Multi-agent orchestration** — Orchestrator delegates tasks to specialized workers
- **Persistent split dashboard** — Chat sessions always visible alongside content
- **Knowledge inbox** — Agents deposit files (reports, diagrams, data) for user review
- **File explorer** — Browse, drag-and-drop, rename, and delete inbox files
- **In-place editing** — Edit and save markdown and Excalidraw files directly in the dashboard
- **Any LLM provider** — OpenAI-compatible or Anthropic-compatible endpoints (not locked to one vendor)
- **4-tier capability discovery** — Dynamic model capability detection (manual → cache → models.dev → probe)
- **File-based agent config** — Define agents as `.md` files with YAML frontmatter
- **Plugin system** — Renderers and UI extensions are packaged as plugins
- **Real-time collaboration** — Councils for multi-agent deliberation

## Quick Start

These steps get a fresh copy of the app running on your machine.

### 1. Prerequisites

- **Node.js 18.18+** (20.x or newer recommended) and **npm 10+**
- An API key for an LLM provider (see [Using any LLM provider](#using-any-llm-provider))

### 2. Clone and install

```bash
git clone https://github.com/<you>/agent-harness.git
cd agent-harness
npm install
```

This installs all three workspace packages (`core`, `server`, `dashboard`).

### 3. Configure your API key

Create a `.env` file in the project root:

```bash
cp .env.example .env
```

Then edit `.env` and set your provider key. The quickest option — using an OpenAI-compatible provider:

```bash
OPENAI_API_KEY=sk-...
API_KEY_ENV=OPENAI_API_KEY
PROVIDER_ENDPOINT=https://api.openai.com/v1
```

> **No key or provider required?** The app reads its key from the `OPENCODE_API_KEY` environment variable and talks to `https://opencode.ai/zen/go/v1` by default. Any OpenAI-compatible or Anthropic-compatible endpoint works — see [Using any LLM provider](#using-any-llm-provider).

### 4. Start in development mode

```bash
npm run dev
```

This starts everything in parallel:

| Process | URL |
|---|---|
| Dashboard (Next.js) | http://localhost:3000 |
| Server API + WebSocket (Express) | http://localhost:3001 |
| Core package (watch mode) | — |

### 5. Open the dashboard

Navigate to **http://localhost:3000**. Click **+** in the right panel to create a session, then send a message like *"List the files in this project."*

## Your First Conversation

1. **Create a session**: Click the **+** button in the right panel
2. **Send a message**: e.g. *"Create a markdown report summarizing this project and save it to the inbox as project-summary.md"*
3. **Watch the orchestrator work**: it will explore with its tools, generate the report, and deposit it in the inbox
4. **Open the result**: click the file in the inbox explorer — it renders in the right panel

## Using Any LLM Provider

The app is **not** locked to a single vendor. It talks to whatever endpoint you configure using standard OpenAI-compatible (`/chat/completions`) and Anthropic-compatible (`/messages`) APIs.

| Setting | Env var | Default | Purpose |
|---|---|---|---|
| API base URL | `PROVIDER_ENDPOINT` | `https://opencode.ai/zen/go/v1` | Base URL of your LLM API |
| Key source | `API_KEY_ENV` | `OPENCODE_API_KEY` | Which env var holds the API key |
| Default model | `DEFAULT_MODEL` | `opencode-go/qwen3.7-plus` | Model used for new agents |

Examples that work out of the box:

```bash
# Anthropic
ANTHROPIC_API_KEY=sk-ant-...
API_KEY_ENV=ANTHROPIC_API_KEY
PROVIDER_ENDPOINT=https://api.anthropic.com/v1

# OpenAI
OPENAI_API_KEY=sk-...
API_KEY_ENV=OPENAI_API_KEY
PROVIDER_ENDPOINT=https://api.openai.com/v1

# OpenRouter
OPENROUTER_API_KEY=sk-or-...
API_KEY_ENV=OPENROUTER_API_KEY
PROVIDER_ENDPOINT=https://openrouter.ai/api/v1

# Local Ollama (OpenAI-compatible)
PROVIDER_ENDPOINT=http://localhost:11434/v1
```

**Model routing note:** a small set of models (`minimax-m3`, `minimax-m2.x`, `qwen3.7-max`, `qwen3.7-plus`, `qwen3.6-plus`) are sent to the **Anthropic** message format; everything else uses the **OpenAI** chat-completions format. Pick a model that matches your provider's protocol, and set it in agent configs or `DEFAULT_MODEL`.

**Capability discovery:** the system checks the model's capabilities in four tiers — manual override in the agent config, a local cache (`.harness/capabilities.json`), the models.dev API, then a direct probe. It never hardcodes capabilities and adapts automatically as models change.

## Production

```bash
npm run build
npm start
```

`npm run build` compiles all packages; `npm start` runs the built server (port `3001`) and dashboard (port `3000`).

> The dashboard expects the API at `http://localhost:3001`. For other setups, override `NEXT_PUBLIC_API_URL` when building the dashboard.

## Configuration Reference

These are read from the environment or the dashboard **Settings** page (persisted to `.harness/settings.json`). Environment variables take precedence.

| Variable | Default | Description |
|---|---|---|
| `ROOT` | repo root | Project root — the sandbox boundary for file tools |
| `INBOX_ROOT` | `./inbox` | Where inbox files are stored |
| `SESSIONS_DIR` | `./sessions` | Session transcript files |
| `AGENTS_DIR` | `./agents` | Agent config `.md` files |
| `PROVIDER_ENDPOINT` | `https://opencode.ai/zen/go/v1` | LLM API base URL |
| `API_KEY_ENV` | `OPENCODE_API_KEY` | Env var that holds the provider key |
| `DEFAULT_MODEL` | `opencode-go/qwen3.7-plus` | Default model for new agents |
| `MAX_CONCURRENT_AGENTS` | `10` | Max parallel agent executions |
| `PORT` | `3001` | Server port |
| `GEMINI_API_KEY` | — | Optional — enables Gemini TTS voice output |

## Architecture

```
agent-harness/
├── packages/
│   ├── core/          # Harness engine (pure TypeScript library)
│   ├── server/        # HTTP + WebSocket API (Express + socket.io)
│   └── dashboard/     # Next.js frontend (persistent split layout)
├── agents/            # File-based agent configs (*.md)
├── .harness/          # Runtime data (capabilities cache, settings, plugin state)
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
│   / → inbox explorer          │  │   Chat stream            │   │
│   /agents → config manager    │  │   (orchestrator msgs,    │   │
│   /settings → settings        │  │    delegation cards,     │   │
│   /plugins → plugin manager   │  │    council activity)     │   │
│                               │  ├──────────────────────────┤   │
│                               │  │  [Input]                 │   │
│                               │  └──────────────────────────┘   │
└───────────────────────────────┴──────────────────────────────────┘
```

## Agent Configuration

Agents are markdown files in `agents/` with YAML frontmatter:

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

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `name` | string | yes | Agent identifier |
| `model` | string | yes | Model name |
| `tools` | string[] | yes | List of tool names |
| `maxSteps` | number | yes | Max tool-call iterations |
| `capabilities` | object | no | Manual capability overrides |
| `modelIdMapping` | string | no | Explicit models.dev ID |

**Available tools:** `readFile`, `writeFile`, `editFile`, `listDirectory`, `glob`, `grep`, `runCommand`, `webFetch`.

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
GET    /api/inbox/tree              # Get inbox file tree
GET    /api/inbox/file?path=...     # Get a file's content
PUT    /api/inbox/file?path=...     # Overwrite a file's content
DELETE /api/inbox/file?path=...     # Delete a file
POST   /api/inbox/move              # Move/rename a file or folder
POST   /api/inbox/dir               # Create a folder
POST   /api/inbox/open              # Reveal a file in the OS explorer
GET    /api/inbox/:id               # Get inbox item by id
PUT    /api/inbox/:id/track         # Register metadata
GET    /api/plugins                 # List plugins
PUT    /api/plugins/:name           # Enable/disable a plugin
GET    /api/settings                # Get settings
PUT    /api/settings                # Update settings
POST   /api/tts                     # Text-to-speech
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
- `plugin/` — Plugin manifest types
- `persistence/` — Session storage, config loader, capability cache
- `presentation/` — Inbox manager
- `tts/` — Text-to-speech (Gemini)

### Server Package (`packages/server`)

Express + socket.io HTTP server:

- `routes/` — REST API endpoints
- `ws/` — WebSocket event handlers
- `plugin/` — Server-side plugin registry

### Dashboard Package (`packages/dashboard`)

Next.js frontend with persistent split layout:

- `app/` — Next.js App Router pages
- `components/` — React components (chat, inbox, layout, settings, agents)
- `components/inbox/renderers/` — File-type renderers (markdown, csv, pdf, …)
- `plugins/_built-in/` — Bundled plugins (each with a `manifest.json`)
- `stores/` — Zustand state management
- `lib/` — API client, WebSocket client

## Development

### Adding a New Tool

1. Create tool file in `packages/core/src/tool/`
2. Implement the `Tool` interface with a Zod schema
3. Export from `packages/core/src/index.ts`
4. Register it in the tool registry when creating agents

### Adding a New Renderer

1. Create renderer component in `packages/dashboard/src/components/inbox/renderers/`
2. Export from `renderers/index.ts`
3. Add to `InboxItemView.tsx` type dispatch

### Adding a New API Endpoint

1. Create a route file in `packages/server/src/routes/`
2. Mount it in `packages/server/src/index.ts`
3. Add a client function in `packages/dashboard/src/lib/api.ts`

## Troubleshooting

### Server won't start

- Check if port 3001 is already in use
- Verify your provider key is set (see [Using any LLM provider](#using-any-llm-provider))
- Check the server logs for errors

### "API key not configured"

Set the env var named by `API_KEY_ENV` (default `OPENCODE_API_KEY`) in `.env` and restart the server.

### Dashboard won't connect

- Ensure the server is running on port 3001
- Check the browser console for CORS errors
- Verify the API URL the dashboard is built with (`NEXT_PUBLIC_API_URL`, default `http://localhost:3001`)

### Agent execution fails

- Check agent config syntax (YAML frontmatter)
- Verify the model name is valid for your provider
- Check the capability registry for model support

## License

MIT
