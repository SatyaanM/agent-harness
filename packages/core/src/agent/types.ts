export * from "../contracts/agent.js";

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
