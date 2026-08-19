export interface FakeToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

export interface FakeScenarioResponse {
  content?: string;
  toolCalls?: FakeToolCall[];
  status?: number;
  headers?: Record<string, string>;
  disconnectMidStream?: boolean;
  delayMs?: number;
  stopReason?: "stop" | "tool-calls" | "length" | "error";
}

export interface ScenarioMessage {
  role: string;
  content: unknown;
}

export type ScenarioHandler = (messages: ScenarioMessage[]) => FakeScenarioResponse;

export interface FakeScenario {
  name: string;
  description: string;
  handle: ScenarioHandler;
}

// In-memory state tracker for stateful scenarios (e.g. rate-limit-then-success)
const scenarioCallCounts = new Map<string, number>();

export function getScenarioCallCount(scenarioName: string): number {
  return scenarioCallCounts.get(scenarioName) ?? 0;
}

export function resetScenarioCallCounts(): void {
  scenarioCallCounts.clear();
}

export function incrementScenarioCallCount(scenarioName: string): number {
  const current = scenarioCallCounts.get(scenarioName) ?? 0;
  const next = current + 1;
  scenarioCallCounts.set(scenarioName, next);
  return next;
}

export function extractTextFromContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((item) => {
        if (typeof item === "string") return item;
        if (typeof item === "object" && item !== null) {
          if ("text" in item && typeof item.text === "string") return item.text;
          if ("content" in item && typeof item.content === "string") return item.content;
        }
        return "";
      })
      .join(" ");
  }
  return "";
}

function hasToolResultInContent(content: unknown): boolean {
  if (!Array.isArray(content)) return false;
  return content.some(
    (item) =>
      typeof item === "object" &&
      item !== null &&
      "type" in item &&
      (item.type === "tool-result" || item.type === "tool_result"),
  );
}

export const SCENARIOS: Record<string, FakeScenario> = {
  "simple-reply": {
    name: "simple-reply",
    description: "Returns a deterministic text reply.",
    handle: (messages) => {
      const lastMsg = messages[messages.length - 1];
      const promptText = extractTextFromContent(lastMsg?.content) || "Hello";
      return {
        content: `Deterministic reply for: ${promptText.slice(0, 100)}`,
        stopReason: "stop",
      };
    },
  },

  "streaming-reply": {
    name: "streaming-reply",
    description: "Emits a multi-token streaming response.",
    handle: () => ({
      content: "This is a deterministic streaming response from the fake LLM test provider.",
      delayMs: 10,
      stopReason: "stop",
    }),
  },

  "tool-call-simple": {
    name: "tool-call-simple",
    description:
      "Emits a tool call on first turn, then provides a final summary on tool result turn.",
    handle: (messages) => {
      const hasToolResult = messages.some(
        (m) => m.role === "tool" || hasToolResultInContent(m.content),
      );
      if (hasToolResult) {
        return {
          content: "Tool execution finished successfully. Here is the verified summary.",
          stopReason: "stop",
        };
      }
      return {
        content: "I will check the files for you.",
        toolCalls: [
          {
            id: "call_mock_tool_001",
            name: "glob",
            arguments: { pattern: "*.json" },
          },
        ],
        stopReason: "tool-calls",
      };
    },
  },

  "delegate-worker": {
    name: "delegate-worker",
    description: "Emits a delegate tool call to spawn a background worker subagent.",
    handle: (messages) => {
      const hasToolResult = messages.some(
        (m) => m.role === "tool" || hasToolResultInContent(m.content),
      );
      if (hasToolResult) {
        return {
          content: "Worker completed task. Summary of background delegated execution materialized.",
          stopReason: "stop",
        };
      }
      return {
        content: "Delegating research to background worker subagent.",
        toolCalls: [
          {
            id: "call_delegate_001",
            name: "delegate",
            arguments: {
              prompt: "Perform background research on SQLite WAL benchmarks",
            },
          },
        ],
        stopReason: "tool-calls",
      };
    },
  },

  "rate-limit-retry": {
    name: "rate-limit-retry",
    description: "Returns HTTP 429 once, then succeeds on subsequent attempt.",
    handle: () => {
      const count = incrementScenarioCallCount("rate-limit-retry");
      if (count === 1) {
        return {
          status: 429,
          headers: { "retry-after": "1" },
          content: JSON.stringify({
            error: {
              message: "Rate limit exceeded: simulated test quota limit",
              type: "rate_limit_error",
              code: 429,
            },
          }),
        };
      }
      return {
        content: "Recovery after rate limit retry succeeded.",
        stopReason: "stop",
      };
    },
  },

  "server-error": {
    name: "server-error",
    description: "Returns HTTP 500 Internal Server Error.",
    handle: () => ({
      status: 500,
      content: JSON.stringify({
        error: {
          message: "Internal server error: simulated fake provider fault injection",
          type: "api_error",
          code: 500,
        },
      }),
    }),
  },

  "mid-stream-disconnect": {
    name: "mid-stream-disconnect",
    description: "Begins streaming SSE response and abruptly terminates socket mid-stream.",
    handle: () => ({
      content: "This response will be cut off mid-way...",
      disconnectMidStream: true,
    }),
  },
};

export function matchScenario(scenarioName?: string, messages?: ScenarioMessage[]): FakeScenario {
  if (scenarioName && SCENARIOS[scenarioName]) {
    const s = SCENARIOS[scenarioName];
    if (s) return s;
  }

  // Detect E2E_SCENARIO:<name> in message contents
  if (messages && messages.length > 0) {
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];
      const text = extractTextFromContent(msg?.content);
      if (text) {
        const match = text.match(/E2E_SCENARIO:([a-zA-Z0-9_-]+)/);
        const name = match?.[1];
        if (name && SCENARIOS[name]) {
          const s = SCENARIOS[name];
          if (s) return s;
        }
      }
    }
  }

  return (
    SCENARIOS["simple-reply"] ?? {
      name: "simple-reply",
      description: "Fallback simple reply",
      handle: () => ({ content: "Default fake provider response", stopReason: "stop" }),
    }
  );
}
