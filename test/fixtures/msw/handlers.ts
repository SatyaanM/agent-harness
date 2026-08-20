export interface MockSessionFixture {
  sessionId: string;
  taskId: string;
  agentName: string;
  prompt: string;
  messages: Array<{ role: string; content: string; sequence_num?: number }>;
  mailbox: Array<{ id: number; taskId: string; payload: unknown; status: string }>;
  createdAt: string;
}

export interface MockAgentFixture {
  name: string;
  model: string;
  description?: string;
  tools?: string[];
}

export interface MockSettingsFixture {
  defaultAgent?: string;
  DEFAULT_MODEL?: string;
  availableModels?: string[];
  MAX_CONCURRENT_AGENTS?: number;
}

export const DEFAULT_MOCK_SETTINGS: MockSettingsFixture = {
  defaultAgent: "orchestrator",
  DEFAULT_MODEL: "opencode-go/qwen3.7-plus",
  availableModels: ["opencode-go/qwen3.7-plus", "gpt-4o", "claude-3-5-sonnet-20241022"],
  MAX_CONCURRENT_AGENTS: 10,
};

export const DEFAULT_MOCK_AGENTS: MockAgentFixture[] = [
  {
    name: "orchestrator",
    model: "opencode-go/qwen3.7-plus",
    description: "Lead orchestrator agent",
    tools: ["readFile", "editFile", "writeFile", "glob", "grep", "delegate"],
  },
  {
    name: "researcher",
    model: "opencode-go/qwen3.7-plus",
    description: "Background researcher subagent",
    tools: ["readFile", "glob"],
  },
];

export function createMockSession(
  id = "test-session-1",
  prompt = "Initial Prompt",
): MockSessionFixture {
  return {
    sessionId: id,
    taskId: `task-${id}`,
    agentName: "orchestrator",
    prompt,
    messages: [
      { role: "user", content: prompt, sequence_num: 0 },
      { role: "assistant", content: "Deterministic mock reply", sequence_num: 1 },
    ],
    mailbox: [],
    createdAt: new Date().toISOString(),
  };
}

export function createSSEStreamPayload(chunks: string[]): string {
  let body = "";
  for (const chunk of chunks) {
    body += `data: ${JSON.stringify({ type: "text-delta", text: chunk })}\n\n`;
  }
  body += `data: ${JSON.stringify({ type: "done" })}\n\n`;
  return body;
}
