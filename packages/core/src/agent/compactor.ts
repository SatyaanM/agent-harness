import type { LLMClient, LLMUsage } from "../llm/client.js";
import type { Message } from "./types.js";

export const MAX_COMPACTION_INPUT_CHARACTERS = 256_000;
export const MAX_COMPACTION_FIELD_CHARACTERS = 32_000;
export const MAX_COMPACTION_OUTPUT_TOKENS = 2_048;
export const MAX_COMPACTION_SUMMARY_CHARACTERS = 32_000;
const COMPACTION_PROMPT_RESERVE_TOKENS = 512;

export interface CompactionLimits {
  contextWindowTokens?: number;
  maxOutputTokens?: number;
  preferredProviderId?: string;
  signal?: AbortSignal;
}

export class CompactionResponseError extends Error {
  constructor(
    message: string,
    public readonly usage?: LLMUsage,
  ) {
    super(message);
    this.name = "CompactionResponseError";
  }
}

function boundedField(value: string): string {
  if (value.length <= MAX_COMPACTION_FIELD_CHARACTERS) return value;
  const marker = "\n[truncated]";
  return `${value.slice(0, MAX_COMPACTION_FIELD_CHARACTERS - marker.length)}${marker}`;
}

function projectMessages(messages: Message[], maxCharacters: number): string {
  let projection = "Original messages to compact:\n\n";
  let messageNumber = 1;
  for (const message of messages) {
    const fields = [`[Message ${messageNumber}] Role: ${message.role}`];
    fields.push(`Content: ${boundedField(message.content)}`);
    if (message.role === "assistant" && message.toolCalls?.length) {
      fields.push(`Tool Calls: ${boundedField(JSON.stringify(message.toolCalls))}`);
    }
    if (message.role === "tool") fields.push(`Tool Call ID: ${message.toolCallId}`);
    const block = `${fields.join("\n")}\n\n`;
    const remaining = maxCharacters - projection.length;
    if (block.length <= remaining) {
      projection += block;
    } else {
      const marker = `\n[truncated compaction projection at message ${messageNumber}]`;
      projection += `${block.slice(0, Math.max(0, remaining - marker.length))}${marker}`;
      break;
    }
    messageNumber += 1;
  }
  return projection.slice(0, maxCharacters);
}

function effectiveLimits(limits: CompactionLimits): {
  inputCharacters: number;
  outputTokens: number;
} {
  const contextWindow = limits.contextWindowTokens;
  const providerOutput = limits.maxOutputTokens;
  let outputTokens = Math.min(
    MAX_COMPACTION_OUTPUT_TOKENS,
    providerOutput && providerOutput > 0 ? providerOutput : MAX_COMPACTION_OUTPUT_TOKENS,
  );
  let inputCharacters = MAX_COMPACTION_INPUT_CHARACTERS;
  if (contextWindow && contextWindow > 0) {
    outputTokens = Math.max(1, Math.min(outputTokens, Math.floor(contextWindow / 4)));
    const promptReserve = Math.min(
      COMPACTION_PROMPT_RESERVE_TOKENS,
      Math.max(1, Math.floor(contextWindow / 10)),
    );
    inputCharacters = Math.max(
      1,
      Math.min(MAX_COMPACTION_INPUT_CHARACTERS, (contextWindow - outputTokens - promptReserve) * 4),
    );
  }
  return { inputCharacters, outputTokens };
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export function estimateMessagesTokens(messages: Message[]): number {
  let characters = 2;
  for (const message of messages) {
    characters += message.role.length + message.content.length + 32;
    if (message.role === "assistant") {
      if (message.toolCalls) characters += JSON.stringify(message.toolCalls).length;
    }
    if (message.role === "tool") characters += message.toolCallId.length;
  }
  return Math.ceil(characters / 4);
}

export class Compactor {
  constructor(private readonly llmClient: LLMClient) {}

  async compact(
    messages: Message[],
    model: string,
    limits: CompactionLimits = {},
  ): Promise<{
    summary: string;
    summaryTokenEstimate: number;
    originalTokenEstimate: number;
    usage: LLMUsage;
  }> {
    const originalTokenEstimate = estimateMessagesTokens(messages);

    const effective = effectiveLimits(limits);
    const textBlock = projectMessages(messages, effective.inputCharacters);

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
      maxOutputTokens: effective.outputTokens,
      ...(limits.preferredProviderId ? { preferredProviderId: limits.preferredProviderId } : {}),
      signal: limits.signal,
    });

    const summary = response.message.content.trim();
    const toolCalls = response.toolCalls ?? response.message.toolCalls ?? [];
    if (
      response.finishReason !== "stop" ||
      summary.length === 0 ||
      summary.length > MAX_COMPACTION_SUMMARY_CHARACTERS ||
      toolCalls.length > 0
    ) {
      throw new CompactionResponseError(
        `Invalid compaction response: finish=${response.finishReason}, contentCharacters=${summary.length}, toolCalls=${toolCalls.length}`,
        response.usage,
      );
    }

    return {
      summary,
      summaryTokenEstimate: estimateTokens(summary),
      originalTokenEstimate,
      usage: response.usage ?? {},
    };
  }
}
