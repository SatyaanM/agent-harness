# Quick Start Guide

## First Time Setup

### 1. Install Dependencies

```bash
git clone https://github.com/<you>/agent-harness.git
cd agent-harness
corepack pnpm install
```

### 2. Set API Key

Copy the example env file and fill in your provider key:

```bash
cp .env.example .env
```

Any OpenAI-compatible or Anthropic-compatible provider works. For example:

```bash
OPENAI_API_KEY=sk-...
API_KEY_ENV=OPENAI_API_KEY
PROVIDER_ENDPOINT=https://api.openai.com/v1
```

Or export the key in your shell:

```bash
export OPENCODE_API_KEY="your-api-key-here"
```

See the README's [Using any LLM provider](./README.md#using-any-llm-provider) section for details.

### 3. Start Development Servers

```bash
corepack pnpm run dev
```

This starts:
- **Dashboard**: http://localhost:3000
- **Server API**: http://localhost:3001

### 4. Open Dashboard

Navigate to http://localhost:3000 in your browser.

You'll see:
- **Left panel**: Inbox (empty initially)
- **Right panel**: Chat interface with session tabs

## Your First Conversation

1. **Create a session**: Click the "+" button in the right panel
2. **Send a message**: Type "List the files in the current directory" and press Enter
3. **Watch the response**: The orchestrator will use the `listDirectory` tool and respond

## Creating a Custom Agent

1. Navigate to **Agents** in the top nav
2. Click **Create Agent**
3. Enter a name (e.g., "researcher")
4. Edit the config:

```markdown
---
name: researcher
model: qwen3.7-plus
tools:
  - readFile
  - glob
  - grep
  - webFetch
maxSteps: 30
---

You are a research agent. Your role is to find information by searching
files and the web. Be thorough and cite your sources.
```

5. Click **Save**

## Using the Inbox

When agents create files, they appear in the inbox:

1. Navigate to **Inbox** (home page)
2. Click on a file to view it
3. The file renders based on type:
   - `.md` → Rendered markdown
   - `.html` → Sandboxed iframe
   - `.png`, `.jpg` → Image preview
   - `.pdf` → PDF viewer
   - `.csv` → Table view
   - `.excalidraw` → Diagram viewer
   - Others → Syntax-highlighted text

## Managing Sessions

- **Multiple sessions**: Each tab is an independent conversation
- **Session history**: Sessions persist across page refreshes
- **Switch sessions**: Click any tab to switch
- **New session**: Click "+" for a fresh conversation

## Settings

Navigate to **Settings** to configure:

- **ROOT**: Project root directory (sandbox for tools)
- **INBOX_DIR**: Where inbox files are stored
- **PROVIDER_ENDPOINT**: LLM API endpoint
- **DEFAULT_MODEL**: Default model for new agents
- **MAX_CONCURRENT_AGENTS**: Max parallel agent sessions

## Common Tasks

### Ask the orchestrator to create a report

```
Create a markdown report summarizing the files in this project.
Save it to the inbox as "project-summary.md".
```

The orchestrator will:
1. Use tools to explore the project
2. Generate a report
3. Write it to the inbox
4. You'll see an inbox link in the chat

### Delegate complex work

```
I need you to analyze the codebase and find all TODO comments.
Create a worker to handle this.
```

The orchestrator will:
1. Spawn a worker agent
2. You'll see a delegation card in the chat
3. Worker completes and posts results
4. You'll see a completion card

### Multi-agent collaboration

```
Create a council to discuss the best approach for implementing feature X.
Include a researcher and a developer agent.
```

The orchestrator will:
1. Create a council
2. You'll see council activity cards in the chat
3. Agents deliberate and reach consensus
4. Council dissolves when done

## Troubleshooting

### "API key not configured"

Set `OPENCODE_API_KEY` environment variable and restart the server.

### "Model not found"

Check that the model name in your agent config is valid. The capability registry will attempt to discover it automatically.

### "Tool execution failed"

Check the server logs for details. Common issues:
- File path outside ROOT directory
- Command timeout (>30 seconds)
- Permission errors

### Dashboard won't load

1. Check if server is running: `curl http://localhost:3001/api/health`
2. Check browser console for errors
3. Restart both servers: `pnpm run dev`

## Next Steps

- Read the full [README.md](./README.md) for architecture details
- Customize agent configs for your workflow
- Extend with custom tools (see README.md "Adding a New Tool")
