import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { MessageBus } from "../collaboration/message-bus.js";
import type { LLMClient } from "../llm/client.js";
import type { SessionData } from "../persistence/session.js";
import { SessionStore } from "../persistence/session.js";
import type { Tool, ToolRegistry } from "../tool/types.js";
import { Agent } from "./agent.js";
import type { AgentConfig, AgentResult, TaskId } from "./types.js";
import { Worker } from "./worker.js";

export class Orchestrator {
  private readonly messageBus: MessageBus;
  private readonly sessionStore: SessionStore;
  private readonly toolRegistry: ToolRegistry;
  private readonly llmClient: LLMClient;
  private readonly capabilityRegistry: CapabilityRegistry;
  private readonly config: AgentConfig;
  private readonly orchestratorId: TaskId;
  private agent: Agent;

  constructor(
    config: AgentConfig,
    toolRegistry: ToolRegistry,
    llmClient: LLMClient,
    capabilityRegistry: CapabilityRegistry,
    messageBus: MessageBus,
    sessionsDir: string,
  ) {
    this.config = config;
    this.toolRegistry = toolRegistry;
    this.llmClient = llmClient;
    this.capabilityRegistry = capabilityRegistry;
    this.messageBus = messageBus;
    this.sessionStore = new SessionStore(sessionsDir);
    this.orchestratorId = `orchestrator-${config.name}`;

    this.registerOrchestratorTools();
    this.agent = new Agent(config, toolRegistry, llmClient, capabilityRegistry);
  }

  async run(prompt: string): Promise<AgentResult> {
    return this.agent.run(prompt);
  }

  private registerOrchestratorTools(): void {
    this.toolRegistry.register(this.createDelegateTool());
    this.toolRegistry.register(this.createReadSessionTool());
    this.toolRegistry.register(this.createCheckInboxTool());
  }

  private createDelegateTool(): Tool {
    const parameters = z.object({
      task: z.string().describe("The task description to delegate to a worker agent"),
      model: z.string().describe("The model to use for the worker agent"),
    });

    const self = this;

    return {
      name: "delegate",
      description:
        "Spawn a worker agent to handle a task in the background. Returns a taskId immediately without blocking. The worker will post its completion to your inbox when done.",
      parameters,
      async execute({ task, model }: { task: string; model: string }) {
        return self.delegate(task, model);
      },
    };
  }

  private createReadSessionTool(): Tool {
    const parameters = z.object({
      taskId: z.string().describe("The taskId of the worker session to read"),
    });

    const self = this;

    return {
      name: "readSession",
      description: "Load and return the full session transcript for a delegated task.",
      parameters,
      async execute({ taskId }: { taskId: string }) {
        return self.readSession(taskId);
      },
    };
  }

  private createCheckInboxTool(): Tool {
    const parameters = z.object({});

    const self = this;

    return {
      name: "checkInbox",
      description: "Check the orchestrator's inbox for worker completion messages.",
      parameters,
      async execute() {
        return self.checkInbox();
      },
    };
  }

  async delegate(task: string, model: string): Promise<string> {
    const taskId: TaskId = uuidv4();
    const sessionId = `worker-${taskId}`;

    const workerConfig: AgentConfig = {
      name: `worker-${taskId}`,
      model,
      tools: this.config.tools,
      maxSteps: this.config.maxSteps,
      instructions: this.config.instructions,
    };

    const sessionData: SessionData = {
      sessionId,
      taskId,
      prompt: task,
      messages: [],
      createdAt: new Date().toISOString(),
    };
    await this.sessionStore.save(sessionData);

    const worker = new Worker(
      taskId,
      workerConfig,
      this.toolRegistry,
      this.llmClient,
      this.capabilityRegistry,
      this.orchestratorId,
      this.messageBus,
    );

    void worker.run(task).then(async (result) => {
      const completedSession: SessionData = {
        sessionId,
        taskId,
        prompt: task,
        messages: result.messages,
        result: {
          status: result.status,
          summary: result.summary,
        },
        createdAt: sessionData.createdAt,
        completedAt: new Date().toISOString(),
      };
      await this.sessionStore.save(completedSession);
    });

    return JSON.stringify({ taskId, status: "delegated" });
  }

  async readSession(taskId: TaskId): Promise<string> {
    const sessionId = `worker-${taskId}`;
    const session = await this.sessionStore.load(sessionId);

    if (!session) {
      return JSON.stringify({ error: `Session not found for taskId: ${taskId}` });
    }

    return JSON.stringify(session);
  }

  async checkInbox(): Promise<string> {
    const messages = this.messageBus.readInbox(this.orchestratorId);

    if (messages.length === 0) {
      return JSON.stringify({ messages: [], count: 0 });
    }

    return JSON.stringify({
      messages: messages.map((m) => ({
        from: m.from,
        content: m.content,
        timestamp: m.timestamp,
      })),
      count: messages.length,
    });
  }
}
