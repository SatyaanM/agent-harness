// Explicit named re-exports instead of `export *`: Playwright's ESM loader
// (and Node's cjs-module-lexer in CJS-interop contexts) cannot statically
// detect names re-exported through star re-exports, which makes consumers
// that destructure named imports fail with "does not provide an export
// named ..." at module-link time.

export type {
  AgentConfig,
  AgentResult,
  CapabilityMatrix,
  Message,
  TaskId,
  ToolCall,
} from "../contracts/agent.js";
export {
  AgentConfigSchema,
  AgentResultSchema,
  AssistantMessageSchema,
  CapabilityMatrixSchema,
  MessageSchema,
  SystemMessageSchema,
  TaskIdSchema,
  ToolCallSchema,
  ToolMessageSchema,
  UserMessageSchema,
} from "../contracts/agent.js";

export class AgentCancelledError extends Error {
  constructor() {
    super("Agent run cancelled");
    this.name = "AgentCancelledError";
  }
}

export class AgentBudgetExceededError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AgentBudgetExceededError";
  }
}
