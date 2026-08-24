# Agent Harness

A TypeScript multi-agent orchestration harness with a web dashboard for managing AI agent collaborations.

An **orchestrator agent** can delegate tasks to background **worker agents** and deposit artifacts into a **knowledge inbox** for review. Everything runs through a persistent split-panel dashboard.

> Implementation status: see [`docs/architecture/CURRENT_STATE.md`](docs/architecture/CURRENT_STATE.md). Architecture and feature documents also contain explicit target direction; they are not proof that a capability is wired into the running application.

## Features

- **Multi-agent orchestration** — Orchestrator delegates tasks to specialized workers
- **Persistent split dashboard** — Chat sessions always visible alongside content
- **Knowledge inbox** — Agents deposit files (reports, diagrams, data) for user review
- **File explorer** — Browse, drag-and-drop, rename, and delete inbox files
- **In-place editing** — Edit and save markdown and Excalidraw files directly in the dashboard
- **Multi-provider model routing** — Configure prioritized OpenAI- and Anthropic-compatible providers with per-agent overrides and transient-failure fallback
- **Capability discovery library** — Manual, cache, models.dev, and probe tiers exist in core but are not yet enforced by the live agent path
- **File-based agent config** — Define agents as `.md` files with YAML frontmatter
- **Manifest-backed built-ins** — Enabled inbox renderers and command metadata are discovered by the server
- **Real-time activity** — Agent, worker, tool, and session updates over WebSocket

## Quick Start

These steps get a fresh copy of the app running on your machine.

### 1. Prerequisites

- **Node.js 22.13+** and the repository-pinned **pnpm 11.22.0** through Corepack
- An API key for an LLM provider (see [Using any LLM provider](#using-any-llm-provider))

### 2. Clone and install

```bash
git clone https://github.com/<you>/agent-harness.git
cd agent-harness
corepack pnpm install
```

This installs all workspace packages (`core`, `server`, `dashboard`) and installs the repository's Lefthook-managed Git hooks.

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
corepack pnpm run dev
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

The app can route across multiple OpenAI-compatible (`/chat/completions`) and Anthropic-compatible (`/messages`) providers. Configure provider entries in Settings with an ID, protocol, base URL, API-key environment variable, supported-model patterns, enabled state, and priority. The legacy endpoint and key settings remain the backward-compatible default when no provider entries are configured.

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

**Model routing note:** configured provider entries declare their protocol, optional exact or `*` wildcard model patterns, and optional request/token minute budgets. Lower priorities are attempted first. An agent's optional `provider` frontmatter field selects its preferred eligible provider. Provider IDs and model IDs (including `/`) stay separate and configured model IDs are sent unchanged. A local rate denial or upstream HTTP 429/5xx advances to a fallback; upstream transient failures also open the provider's shared one-minute circuit. Cancellation and non-transient 4xx failures are never replayed. Saving settings aborts active runs, waits for their terminal cleanup, and unloads cached runtimes before the next configuration generation. The legacy synthetic provider retains historical prefix/protocol compatibility when the registry is absent.

**Capability discovery status:** core contains manual, cache, models.dev, and probe tiers, but `Agent.run()` does not currently call the registry. Treat configured tools and provider compatibility as operator responsibility until that integration is designed and tested.

## Production

```bash
corepack npm run build
corepack npm start
```

`npm run build` compiles all packages; `npm start` runs the built server (port `3001`) and dashboard (port `3000`).

> The dashboard expects the API at `http://localhost:3001`. For other setups, override `NEXT_PUBLIC_API_URL` when building the dashboard.

## Configuration Reference

These are read from the environment or the dashboard **Settings** page (persisted to `.harness/settings.json`). Environment variables take precedence. `ROOT` is environment/discovery-owned and is shown read-only because the settings file beneath it cannot safely redefine its own location or sandbox boundary.

| Variable | Default | Description |
|---|---|---|
| `ROOT` | repo root | Environment-owned project root — the read-only sandbox boundary for file tools |
| `INBOX_ROOT` | `./inbox` | Where inbox files are stored |
| `SESSIONS_DIR` | `./sessions` | Session transcript files |
| `AGENTS_DIR` | `./agents` | Agent config `.md` files |
| `PROVIDER_ENDPOINT` | `https://opencode.ai/zen/go/v1` | LLM API base URL |
| `API_KEY_ENV` | `OPENCODE_API_KEY` | Env var that holds the provider key |
| `DEFAULT_MODEL` | `opencode-go/qwen3.7-plus` | Default model for new agents |
| `MAX_CONCURRENT_AGENTS` | `10` | Process-wide cap for active parent and worker agent executions |
| `PORT` | `3001` | Server port |
| `HOST` | `127.0.0.1` | Server bind host; defaults to loopback rather than all interfaces |
| `CORS_ORIGINS` | local dashboard origins | Comma-separated browser origins allowed by HTTP and WebSocket CORS |
| `ENABLE_RUN_COMMAND` | `false` | Explicitly enable the OS-privileged shell tool |
| `ENABLE_WEB_FETCH` | `false` | Explicitly enable the public-network fetch tool |
| `PLUGINS_DIR` | dashboard plugin directory | Optional absolute directory containing plugin manifests |
| `GEMINI_API_KEY` | — | Optional — enables Gemini TTS voice output |
| `OTEL_ENABLED` | `false` | Enable OpenTelemetry distributed tracing |
| `OTEL_EXPORTER_OTLP_ENDPOINT` | — | Optional OTLP HTTP collector endpoint (e.g. `http://localhost:4318/v1/traces`) |
| `OTEL_SERVICE_NAME` | `agent-harness` | OpenTelemetry service name |

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
| `description` | string | no | Short agent description shown by the dashboard |
| `model` | string | yes | Model name |
| `tools` | string[] | yes | List of tool names; an empty list is valid |
| `maxSteps` | number | yes | Max tool-call iterations |
| `maxToolCalls` | number | no | Run-wide tool-call cap; defaults to 64 |
| `maxToolResultChars` | number | no | Per-result model-context and transient-event cap; defaults to 100,000 characters. Durable transcripts retain the complete tool result. |
| `maxOutputTokens` | number | no | Per-provider-call output cap; defaults to 4,096 tokens |
| `maxTotalTokens` | number | no | Run-wide token cap; uses provider usage or a conservative fallback estimate and defaults to 100,000 tokens |
| `runTimeoutMs` | number | no | Run deadline; defaults to 300,000 ms and aborts provider/tool work through an `AbortSignal` |
| `provider` | string | no | Preferred configured provider ID; eligible fallback providers remain available for transient 429/5xx failures |
| `capabilities` | object | no | Manual capability overrides |
| `modelIdMapping` | string | no | Explicit models.dev ID |

**Available tools:** `readFile`, `writeFile`, `editFile`, `listDirectory`, `glob`, and `grep`. The privileged `runCommand` and `webFetch` tools are disabled by default; opt in with `ENABLE_RUN_COMMAND=true` and `ENABLE_WEB_FETCH=true` after reviewing [the security boundary](docs/SECURITY.md).

## API Reference

### REST Endpoints

```
POST   /api/chat                    # Send message (SSE stream)
GET    /api/sessions                # List bounded session metadata
GET    /api/sessions/meta           # Metadata-list alias
GET    /api/sessions/diagnostics    # List safe invalid-record diagnostics
POST   /api/sessions                # Create session
GET    /api/sessions/:id            # Get session
PATCH  /api/sessions/:id            # Rename or clear a session title
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
GET    /api/metrics                 # Prometheus, OpenMetrics, and JSON runtime & execution metrics
```

### WebSocket Events

```
agent:started        # Agent began execution
agent:completed      # Agent finished
agent:error          # Agent encountered error
agent:tool           # Agent called/completed a tool (live activity)
worker:spawned       # A worker session was created
worker:completed     # A worker posted a completion to its delegator
session:updated      # A session's state changed (authoritative sync)
```

## Project Structure

### Core Package (`packages/core`)

Pure TypeScript library with no HTTP/UI dependencies:

- `agent/` — Agent, session runtime, delegation, and Worker execution
- `capability/` — 4-tier capability registry
- `collaboration/` — MessageBus, Council, Supervision
- `crypto/` — Canonical JSON (RFC 8785), SHA-256 audit hash chaining, redaction
- `tool/` — Tool implementations (readFile, writeFile, etc.)
- `llm/` — Vercel AI SDK adapter
- `plugin/` — Plugin manifest types
- `persistence/` — SQLite WAL database, repositories, schema migrator, legacy migrator
- `presentation/` — Inbox manager
- `telemetry/` — OpenTelemetry W3C trace context, spans, and tracer contracts
- `tts/` — Text-to-speech (Gemini)

### Server Package (`packages/server`)

Express + socket.io HTTP server:

- `routes/` — REST API endpoints (chat, sessions, agents, inbox, plugins, settings, metrics, tts)
- `ws/` — WebSocket event handlers
- `plugin/` — Server-side plugin registry
- `telemetry/` — ServerTracer, batched OTLP exporter, Prometheus/OpenMetrics registry

### Dashboard Package (`packages/dashboard`)

Next.js frontend with persistent split layout:

- `app/` — Next.js App Router pages
- `components/` — React components (chat, inbox, layout, settings, agents)
- `components/inbox/renderers/` — File-type renderers (markdown, csv, pdf, …)
- `plugins/_built-in/` — Bundled plugins (each with a `manifest.json`)
- `stores/` — Zustand state management
- `lib/` — API client, WebSocket client

## Development

### Quality, tests, and Git hooks

The root scripts are the supported entry points for local development and coding agents:

| Command | Purpose |
|---|---|
| `corepack pnpm run quality` | Check Biome formatting, lint rules, and import organization |
| `corepack pnpm run quality:fix` | Apply Biome's safe fixes |
| `corepack pnpm run quality:policy` | Enforce strict TypeScript, Knip config policies, and AST quality rules |
| `corepack pnpm run knip` | Find and prune unused files, exports, and dependencies |
| `corepack pnpm test` | Run all Vitest projects once |
| `corepack pnpm run test:watch` | Run the Vitest project matrix in watch mode |
| `corepack pnpm run test:ui` | Open the local Vitest UI |
| `corepack pnpm run test:coverage` | Run V8 coverage and write text, HTML, and LCOV reports under `coverage/` |
| `corepack pnpm run test:e2e` | Run Playwright end-to-end browser test suite |
| `corepack pnpm run audit:verify` | Verify SHA-256 hash-chain continuity of the SQLite audit log in $O(1)$ memory |
| `corepack pnpm run check:fast` | Run local static checks, typecheck, and tests without a production build |
| `corepack pnpm run check` | Run the complete credential-free repository verification suite |
| `corepack pnpm run check:ci` | Run authoritative CI checks, coverage, builds, and the production audit |
| `corepack pnpm run security:audit` | Reject high/critical production advisories without an unexpired exception |
| `corepack pnpm run perf:report` | Report the local validation throughput benchmark without a noisy timing gate |
| `corepack pnpm run check:nightly` | Run CI checks plus the informational performance report |

Run the complete check before handing work off:

```bash
corepack pnpm run check
```

The check runs Biome, the repository policy, documentation and skill validation, typecheck, Knip dead-code verification, tests, builds, and diff whitespace checks. GitHub Actions runs `check:ci` on pull requests and main, while the nightly workflow adds the benchmark report.

Lefthook is installed automatically by `corepack pnpm install`. The pre-commit hook applies safe Biome fixes to staged files, re-stages those fixes, and runs documentation, skill, and whitespace checks in parallel (< 350ms). Commitlint enforces Conventional Commits on commit messages. The pre-push hook runs the fast check suite. Repair or refresh the hooks manually with:

```bash
corepack pnpm run hooks:install
```

The installer removes only this repository's obsolete `core.hooksPath=hooks` setting. It preserves and skips installation when a contributor has configured a different custom hook path.

Privileged tools are application-level controls, not a process sandbox. File operations resolve symlinks before authorization, subprocesses inherit only a small operating-system allowlist, and outbound fetches reject credentials, private/reserved addresses, and unsafe redirects. The server binds to loopback by default. See [`docs/SECURITY.md`](docs/SECURITY.md) for the threat boundary and residual risks.

### Adding a New Tool

1. Create tool file in `packages/core/src/tool/`
2. Implement the `Tool` interface with a Zod schema
3. Export from `packages/core/src/index.ts`
4. Register it in the tool registry when creating agents

### Adding a New Renderer

1. Create renderer component in `packages/dashboard/src/components/inbox/renderers/`
2. Export from `renderers/index.ts`
3. Register its component key in `packages/dashboard/src/plugins/registry.ts`
4. Add an `inboxRenderers` entry to a built-in plugin `manifest.json`; `InboxItemView.tsx` resolves through the plugin store and component registry

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
