---
name: fullstack-e2e
description: Execute full-stack Playwright E2E suites against isolated ephemeral backend instances, inspect SQLite state, and triage browser test results.
---

# Full-Stack E2E Testing

## Overview

Full-stack end-to-end tests run real browser interactions in Playwright against an ephemeral, isolated test environment containing:
- A temporary SQLite WAL database
- A live Express + Socket.IO backend
- A live Next.js dashboard
- A local, deterministic Fake LLM provider

## Running Full-Stack Specs

Execute the full-stack Playwright specs:

```powershell
corepack pnpm run test:fullstack
```

To run a specific spec:

```powershell
corepack pnpm --filter @agent-harness/dashboard test:e2e packages/dashboard/e2e/fullstack/session-lifecycle.spec.ts
```

## Ephemeral Test Stack Lifecycle

The ephemeral test harness (`test/helpers/test-stack.ts`) manages:
1. Allocation of non-colliding dynamic ports on `127.0.0.1`.
2. Clean initialization and migration of the SQLite database in an OS temporary folder.
3. Supervised shutdown releasing all socket and file handles cleanly on Windows and Linux.
