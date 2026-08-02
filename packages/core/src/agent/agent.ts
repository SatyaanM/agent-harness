import type { AgentConfig, AgentResult, Message } from "./types.js";
import { AgentCancelledError } from "./types.js";
import type { ToolRegistry } from "../tool/types.js";
import type { LLMClient, LLMToolDefinition } from "../llm/client.js";
import type { CapabilityRegistry } from "../capability/registry.js";

export type AgentEventCallback = (event: {
  type: "tool:called" | "tool:completed";
  toolName: string;
  args?: Record<string, unknown>;
  result?: string;
}) => void;

export class Agent {
  private messages: Message[] = [];

  constructor(
    private readonly config: AgentConfig,
    private readonly toolRegistry: ToolRegistry,
    private readonly llmClient: LLMClient,
    private readonly capabilityRegistry: CapabilityRegistry,
    private readonly onEvent?: AgentEventCallback,
  ) {}

  async run(prompt?: string, history: Message[] = [], signal?: AbortSignal): Promise<AgentResult> {
    this.messages = [...history];
    if (prompt) {
      this.messages.push({ role: "user", content: prompt });
    }

    const tools = this.config.tools
      .map((name) => this.toolRegistry.get(name))
      .filter((t): t is NonNullable<typeof t> => t != null);

    const llmTools: LLMToolDefinition[] | undefined = tools.length
      ? tools.map((t) => ({
          name: t.name,
          description: t.description,
          parameters: t.parameters,
        }))
      : undefined;

    for (let step = 0; step < this.config.maxSteps; step++) {
      if (signal?.aborted) throw new AgentCancelledError();

      const response = await this.llmClient.chat({
        messages: this.messages,
        system: this.config.instructions,
        model: this.config.model,
        ...(llmTools ? { tools: llmTools } : {}),
        ...(signal ? { signal } : {}),
      });

      this.messages.push(response.message);

      if (response.finishReason === "stop") {
        return {
          status: "success",
          summary: response.message.content,
          messages: [...this.messages],
        };
      }

      if (response.toolCalls?.length) {
        for (const toolCall of response.toolCalls) {
          if (signal?.aborted) throw new AgentCancelledError();

          const tool = this.toolRegistry.get(toolCall.toolName);

          if (!tool) {
            this.messages.push({
              role: "tool",
              content: `Error: Tool "${toolCall.toolName}" not found`,
              toolCallId: toolCall.toolCallId,
            });
            continue;
          }

          this.onEvent?.({
            type: "tool:called",
            toolName: toolCall.toolName,
            args: toolCall.args,
          });

          try {
            const result = await tool.execute(toolCall.args);
            this.onEvent?.({
              type: "tool:completed",
              toolName: toolCall.toolName,
              result,
            });
            this.messages.push({
              role: "tool",
              content: result,
              toolCallId: toolCall.toolCallId,
            });
          } catch (error) {
            const errorMessage = error instanceof Error ? error.message : String(error);
            console.error(`[Agent] Tool "${toolCall.toolName}" failed:`, error);
            this.messages.push({
              role: "tool",
              content: `Error: ${errorMessage}`,
              toolCallId: toolCall.toolCallId,
            });
          }
        }
      }
    }

    return {
      status: "maxStepsReached",
      summary: this.messages[this.messages.length - 1]?.content ?? "",
      messages: [...this.messages],
    };
  }
}
