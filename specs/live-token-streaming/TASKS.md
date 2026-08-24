---
summary: Implementation tasks for Live Token Streaming
read_when:
  - Checking progress on Live Token Streaming tasks.
---

# Live Token Streaming Tasks

- [x] Add `LLMStreamDelta` and `chatStream` interface to `packages/core/src/llm/client.ts`.
- [x] Implement `chatStream` using `streamText` in `packages/core/src/llm/vercel-ai.ts`.
- [x] Modify `Agent.run()` in `packages/core/src/agent/agent.ts` to consume the stream.
- [x] Implement tool-call-delta buffering and final execution logic.
- [x] Add Time to First Token (TTFT) and Tokens Per Second (TPS) metric calculation.
- [x] Plumb partial tool streams and text streams out of the runtime via callback/iterator.
- [x] Update `packages/server/src/routes/chat.ts` to pipe the true stream to SSE and retain chunked fallback only for non-streaming agents.
- [x] Write tests ensuring identical database transcripts between streaming and non-streaming modes.
- [x] Verify SDK error/abort parts, missing terminal finish, malformed tool deltas, client cancellation, mid-stream disconnect, SSE error delivery, and non-streaming fallback.
