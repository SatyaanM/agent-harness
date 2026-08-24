import type { LLMClient, LLMUsage } from "../llm/client.js";
import type { Message } from "./types.js";

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
  return estimateTokens(JSON.stringify(messages));
}

export class Compactor {
  constructor(private readonly llmClient: LLMClient) {}

  async compact(
    messages: Message[],
    model: string,
    signal?: AbortSignal,
  ): Promise<{
    summary: string;
    summaryTokenEstimate: number;
    originalTokenEstimate: number;
    usage: LLMUsage;
  }> {
    const originalTokenEstimate = estimateMessagesTokens(messages);

    let textBlock = "Original messages to compact:\n\n";
    let i = 1;
    for (const m of messages) {
      if (!m) continue;
      textBlock += `[Message ${i}] Role: ${m.role}\nContent: ${m.content}\n`;
      if (m.role === "assistant" && m.toolCalls && m.toolCalls.length > 0) {
        textBlock += `Tool Calls: ${JSON.stringify(m.toolCalls)}\n`;
      }
      textBlock += "\n";
      i++;
    }

    const systemPrompt = `You are a conversation compactor. Your job is to summarize the following conversation history into a single comprehensive summary.
CRITICAL INSTRUCTIONS:
1. You MUST extract key entities, persistent facts, user preferences, and unresolved goals into a distinct structured memory block or key-value format at the beginning of your summary.
2. Ensure critical discrete state (like file paths, subagent IDs, configuration choices) survives multiple rolling compactions.
3. Provide a clear chronological summary of the actions taken and results obtained.
4. Do not drop important details that a future agent might need to continue the task.`;

    const response = await this.llmClient.chat({
      model,
      system: systemPrompt,
      messages: [{ role: "user", content: textBlock }],
      signal,
    });

    const summary = response.message.content;

    return {
      summary,
      summaryTokenEstimate: estimateTokens(summary),
      originalTokenEstimate,
      usage: response.usage ?? {},
    };
  }
}
