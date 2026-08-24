---
summary: Adds true token-by-token streaming from the LLM providers through to the browser SSE stream.
read_when:
  - When implementing or reviewing this subsystem
  - When reviewing streaming behavior in agent run loops or the HTTP SSE layer
---

# Live Token Streaming Specification
Status: Implemented

## Problem and evidence

The Agent Harness currently uses a blocking `generateText` call for the LLM provider layer, and the `/api/chat` SSE endpoint waits for the full agent run to complete before slicing the summary into fake 40-character SSE chunks. Users see tool activity streaming over WebSocket in real-time, but the model's text response arrives as a delayed block at the end of the run.

Current evidence in the codebase:
- `packages/core/src/llm/client.ts`: The `LLMClient` interface only defines a blocking `chat(params: LLMChatParams): Promise<LLMResponse>`.
- `packages/core/src/llm/vercel-ai.ts`: Uses the blocking `generateText` from the `ai` package to implement the client. `createVercelAILLMClient(config: Config): LLMClient`.
- `packages/server/src/routes/chat.ts`: The `POST /api/chat` handler awaits the blocking `runtime.deliver(...)` and then emits fake `text-delta` events using a `chunkSummary(summary, 40)` loop.

## Goals and non-goals

### Goals
- Deliver text tokens to the browser SSE connection as soon as they are received from the LLM provider.
- First text token must reach the browser within 500ms of LLM response start.
- Ensure tool calls are buffered until complete before dispatching for execution.
- Maintain identical persisted transcripts regardless of streaming status.
- Allow agents to opt-out of streaming via their configuration/frontmatter.
- Support clean abort/cancellation and error handling mid-stream.
- Maintain backward compatibility for non-streaming agents.

### Non-goals
- Streaming worker transcripts to the delegate drawer (separate feature).
- Refactoring the provider system into a multi-provider registry (separate spec).
- Changing existing WebSocket tool activity events.

## Required behavior

### 1. LLM Client Streaming Interface
Extend the `LLMClient` in `packages/core/src/llm/client.ts` to support a `chatStream` method.

```typescript
export interface LLMStreamDelta {
  type: 'text-delta' | 'tool-call-delta';
  text?: string;
  toolCall?: {
    id: string;
    name: string;
    argumentsDelta: string;
  };
}

export interface LLMClient {
  chat(params: LLMChatParams): Promise<LLMResponse>;
  chatStream(params: LLMChatParams): AsyncIterable<LLMStreamDelta>;
}
```

### 2. Vercel AI SDK Implementation
In `packages/core/src/llm/vercel-ai.ts`, implement `chatStream` using the `streamText` function from the `ai` package (Vercel AI SDK supports this).
The implementation will yield `text-delta` for text chunks and `tool-call-delta` for tool argument chunks, ensuring that the Vercel AI SDK stream events map cleanly to our `LLMStreamDelta` interface.

### 3. Agent Execution and Streaming
Modify `Agent.run()` and `Agent.runWithSignal()` in `packages/core/src/agent/agent.ts` to consume the streaming interface.

- When streaming, the agent run loop will consume `chatStream` deltas.
- **Text Deltas:** Plumb text deltas out to the caller via a callback or async iterable passed/returned in the run context.
- **Tool Calls:** Accumulate `tool-call-delta` pieces internally. Do not execute or dispatch a tool until the stream for that tool call is complete and successfully parsed via Zod. However, the agent MUST emit these partial `tool-call-delta` chunks to the SSE transport layer so the dashboard can render streaming arguments for enhanced user visibility prior to execution.
- **Streaming Telemetry:** The runtime MUST track and calculate Time to First Token (TTFT) and Tokens Per Second (TPS). These performance metrics MUST be persisted in the run metadata and emitted to any active observability plugins.
- Once the stream concludes, assemble the final message and persist it to the transcript exactly as the non-streaming flow does, maintaining transcript fidelity, wake-run guards, and atomic mailbox drains.

### 4. Session Runtime and Transports
Update `SessionRuntime.deliver()` and `SessionRuntime.runOnce()` in `packages/core/src/agent/session-runtime.ts` to pipe text deltas to the SSE transport layer.

- Intercept the text tokens from the agent runner.
- Pipe these tokens to the corresponding transport layer mechanism.

### 5. HTTP SSE Layer
In `packages/server/src/routes/chat.ts`, remove the fake chunking mechanism (`chunkSummary(summary, 40)`).
- Wire the HTTP response stream directly to the text token stream emitted by `SessionRuntime`.
- Write real `text-delta` events to the SSE stream as tokens arrive.
- Close the stream gracefully when the run concludes or aborts.

### 6. Configuration and Fallback
- The capability registry already has a `streaming` field in `CapabilityMatrix`.
- Agents can declare `streaming: boolean` (true|false) in their frontmatter.
- If `streaming: false`, the system falls back to the existing `chat()` behavior, maintaining backward compatibility.

## Acceptance criteria

1. **Time to First Token**: When an agent with `streaming: true` responds, the first `text-delta` SSE event is delivered to the browser within 500ms of the LLM provider beginning its response.
2. **Tool Execution Integrity**: Tools are only executed after their complete argument JSON is received, buffered, and parsed; no partial tools are executed.
3. **Transcript Fidelity**: The final assembled message (text + tool calls) persisted to the database transcript is identical byte-for-byte to the equivalent non-streamed response.
4. **Agent Opt-out**: If an agent specifies `streaming: false` in its frontmatter, it uses the blocking `chat()` pathway and no intermediate text deltas are emitted, functioning exactly as before.
5. **Cancellation**: Emitting an abort signal via `AbortController` stops the LLM stream immediately, aborts mid-stream gracefully, and does not hang the process.
6. **Error Handling**: A mid-stream network or provider error results in a clean error event over SSE, not a hung connection.

## Decisions

- Runtime plumbing uses correlated callbacks from `Agent` through `SessionRuntime`. This preserves the existing serialized `AgentResult` and persistence path while allowing the HTTP adapter to forward deltas immediately.
- Streaming performance is recorded per model step in the durable run row's `token_usage.streaming.steps` metadata and on the active `gen_ai.chat` span. Each record contains TTFT, output-token throughput, output-token count, and total stream duration.
- A stream is successful only after an explicit terminal `finish` part. SDK `error` and `abort` parts, transport EOF, malformed tool arguments, and disconnects are failures and never synthesize a successful stop.
