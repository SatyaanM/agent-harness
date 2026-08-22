---
summary: Implementation tasks for Live Token Streaming
read_when:
  - Checking progress on Live Token Streaming tasks.
---

# Live Token Streaming Tasks

- [ ] Add `LLMStreamDelta` and `chatStream` interface to `packages/core/src/llm/client.ts`.
- [ ] Implement `chatStream` using `streamText` in `packages/core/src/llm/vercel-ai.ts`.
- [ ] Modify `Agent.run()` in `packages/core/src/agent/agent.ts` to consume the stream.
- [ ] Implement tool-call-delta buffering and final execution logic.
- [ ] Add Time to First Token (TTFT) and Tokens Per Second (TPS) metric calculation.
- [ ] Plumb partial tool streams and text streams out of the runtime via callback/iterator.
- [ ] Update `packages/server/src/routes/chat.ts` to pipe the true stream to SSE and remove fake chunking.
- [ ] Write tests ensuring identical database transcripts between streaming and non-streaming modes.
