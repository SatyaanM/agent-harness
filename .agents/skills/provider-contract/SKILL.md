---
name: provider-contract
description: Validate OpenAI and Anthropic LLM provider wire compatibility, streaming SSE envelopes, and fault injection behavior.
---

# Provider Contract Testing

## Overview

Agent Harness integrates with OpenAI and Anthropic protocol-compatible endpoints via `@ai-sdk/openai` and `@ai-sdk/anthropic`. The `test/fake-provider/` mock service provides a zero-cost local testbed ensuring all wire payloads conform to provider specifications.

## Scenarios

Trigger specific scenarios by passing scenario headers or embedding prompt prefixes:

- `simple-reply`: Returns deterministic text response.
- `streaming-reply`: Emits streaming text chunks over SSE.
- `tool-call-simple`: Emits tool call envelopes on turn 1, summary on turn 2.
- `delegate-worker`: Emits subagent delegation tool call.
- `rate-limit-retry`: Emits HTTP 429 once, then succeeds on retry.
- `server-error`: Injects HTTP 500 fault.
- `mid-stream-disconnect`: Simulates abrupt TCP disconnect during streaming.

## Verification

Run provider contract tests:

```powershell
corepack pnpm vitest run test/fake-provider/fake-provider.test.ts
```
