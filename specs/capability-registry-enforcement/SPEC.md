---
summary: Defines the enforcement of the 4-tier capability registry lookup in Agent.run() to properly scope LLM requests based on model capabilities.
read_when:
  - When implementing capability-aware request modification in the agent execution loop
  - When debugging missing tools or stripped vision parts in LLM payloads
---
Status: Draft

## Problem and evidence

The Agent Harness currently includes a sophisticated 4-tier capability lookup system in `@agent-harness/core/capability` (`CapabilityRegistry`), which correctly resolves whether an LLM supports features like chat, tools, vision, and streaming. However, this capability information is not utilized during agent execution. The `Agent` constructor receives a `_capabilityRegistry: CapabilityRegistry` argument, but it goes unused.

Consequently, `Agent.run()` and `Agent.runWithSignal()` in `packages/core/src/agent/agent.ts` unconditionally pass all available tool definitions and vision contents to the underlying LLM client, regardless of the model's actual capabilities. This results in bloated prompt payloads, potential API errors for unsupported features, and dead infrastructure in the capability resolution system.

## Goals and non-goals

### Goals
- Ensure `Agent.run()` utilizes `capabilityRegistry.lookup()` to determine a model's capabilities before sending requests to the LLM.
- Prevent sending unsupported tool definitions and image content parts to models that lack `tools` or `vision` capabilities, respectively.
- Provide a mechanism for users to manually override capabilities via agent frontmatter (Tier 1 lookup).
- Emit diagnostics when there is a mismatch between declared capabilities and model behavior (e.g., unexpected tool calls).
- Maintain backward compatibility by providing permissive defaults when lookup fails.
- Ensure the lookup adds minimal overhead (< 5ms) to run startup by caching results per-run.

### Non-goals
- Modifying the existing 4-tier lookup algorithm itself.
- Changing capabilities dynamically per-tool-call during a single run.
- Providing a UI for browsing or editing capability matrices.
- Implementing plugin-contributed tool capability declarations at this stage.

## Required behavior

### 1. Capability Resolution and Caching
When `Agent.run()` or `Agent.runWithSignal()` starts, it MUST call `this._capabilityRegistry.lookup(provider, model, sdk, agentConfig)` to resolve the `CapabilityMatrix`.
The result MUST be cached for the duration of the run to avoid repeated lookups during multi-step executions.
If the lookup fails entirely across all tiers, the agent MUST fallback to a permissive default (e.g., `{ chat: true, tools: true, vision: true, streaming: false, maxTokens: undefined }`), preserving current behavior.

### 2. Payload Modification based on CapabilityMatrix
Before invoking `llmClient.chat()` (or its streaming equivalent), the agent MUST inspect the resolved `CapabilityMatrix` and modify the request payload as follows:
- **Tools**: If `matrix.tools === false`, the agent MUST omit all tool definitions from the LLM request. Additionally, if Human-in-the-Loop (HITL) enforcement is required by the tool but the model lacks advanced reasoning bounds, the tool MUST be stripped to ensure safety.
- **Vision**: If `matrix.vision === false`, the agent MUST strip all image content parts from the message history before sending them to the LLM.
- **Max Tokens**: If `matrix.maxTokens` is defined, the agent MUST use this value to set the `max_tokens` (or `max_output_tokens`, depending on the provider) on the LLM request, UNLESS a lower explicit limit is set in the agent's specific configuration.
- **Streaming**: If `matrix.streaming === true` and streaming is requested by the invocation, the agent MUST use the streaming path (integrating with the broader streaming implementation).
- **Structured Outputs**: If `matrix.structuredOutputs === true`, the agent MUST use the provider's native JSON schema adherence features. Otherwise, it must inject schema instructions directly into the system prompt.
- **Prompt Caching**: If `matrix.promptCaching === true`, the agent MUST automatically apply caching breakpoints to static parts of the system prompt and long context blocks.

### 3. Agent Frontmatter Overrides
The `AgentConfig` (and its schema in `packages/core/src/agent/types.ts`) MUST support an optional `capabilities` field:
```typescript
interface AgentConfig {
  // existing fields...
  capabilities?: Partial<CapabilityMatrix>;
}
```
This configuration serves as the Tier 1 override in the capability lookup process. When specified, these values take precedence over all other tiers.

### 4. Worker Scope and Delegation
When an agent spawns a worker (in `packages/core/src/agent/delegation.ts`), the worker MUST inherit a scoped capability set from its parent. Specifically, the `delegate` capability MUST be explicitly excluded or disabled for the worker, regardless of the underlying model's capabilities, reinforcing the wake-run guard at the capability layer.

### 5. Diagnostics
The agent MUST monitor the LLM's responses for capability mismatches. If the model returns a tool call request (e.g., a function call) when the resolved capability matrix states `tools: false`, the agent MUST emit a `capability-mismatch` diagnostic event.

## Acceptance criteria

1. **Tool Stripping**: An agent configured with a model that resolves to `tools: false` does not include tool definitions in its payload to `llmClient.chat()`.
2. **Vision Stripping**: An agent configured with a model that resolves to `vision: false` successfully sends messages by stripping any image content parts from the prompt, preventing API rejection.
3. **Frontmatter Override**: An agent defining `capabilities: { tools: false }` in its frontmatter overrides the registry lookup and results in no tools being sent, even if the model inherently supports them.
4. **Diagnostic Emission**: A `capability-mismatch` diagnostic is logged/emitted when a model unexpectedly returns a tool call despite the capability matrix declaring `tools: false`.
5. **Worker Delegation Restriction**: Workers initialized via delegation cannot utilize the `delegate` tool, enforced at the capability scope level.
6. **Per-Run Caching**: The capability registry lookup is performed exactly once per `Agent.run()` execution and cached for all subsequent steps in that run.
7. **Backward Compatibility**: Existing agents with no `capabilities` field in their frontmatter operate identically to their current behavior (utilizing Tier 2-4 lookups or the permissive default if lookups fail).
8. **Performance Target**: The capability lookup process adds less than 5ms to the startup time of an agent run.

## Open questions and decisions

- **Diagnostic Handling**: Should a `capability-mismatch` diagnostic interrupt the run, or merely log and continue execution by failing the specific tool call? *Decision needed: suggest warning and returning a system message to the LLM indicating the tool call is disallowed.*
- **Vision Stripping Detail**: If an image is stripped from a message, should a placeholder (e.g., `[Image omitted due to model capability]`) be inserted in its place to provide context to the LLM?
