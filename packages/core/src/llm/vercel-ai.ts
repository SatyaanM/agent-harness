import { generateText, type LanguageModel } from "ai";
import { createOpenAI } from "@ai-sdk/openai";
import { createAnthropic } from "@ai-sdk/anthropic";
import type { LLMClient, LLMChatParams, LLMResponse } from "./client.js";
import type { Message } from "../agent/types.js";
import type { Config } from "../config.js";

// Models that use Anthropic-compatible endpoint
const ANTHROPIC_MODELS = new Set([
  "minimax-m3",
  "minimax-m2.7",
  "minimax-m2.5",
  "qwen3.7-max",
  "qwen3.7-plus",
  "qwen3.6-plus",
]);

function getModelProvider(modelId: string, config: Config) {
  console.log("[llm] getModelProvider called with:", { modelId, PROVIDER_ENDPOINT: config.PROVIDER_ENDPOINT });

  // Strip "opencode-go/" prefix if present
  const cleanModelId = modelId.startsWith("opencode-go/")
    ? modelId.slice("opencode-go/".length)
    : modelId;

  const isAnthropic = ANTHROPIC_MODELS.has(cleanModelId);
  console.log("[llm] Model routing:", { cleanModelId, isAnthropic, originalModelId: modelId });

  if (isAnthropic) {
    const apiKey = process.env[config.API_KEY_ENV] ?? "";
    console.log("[llm] Creating Anthropic provider:", {
      baseURL: config.PROVIDER_ENDPOINT,
      apiKeySet: !!apiKey,
      apiKeyLength: apiKey.length,
      modelPassedToSDK: cleanModelId,
      expectedUrl: `${config.PROVIDER_ENDPOINT}/messages`,
    });
    const provider = createAnthropic({
      baseURL: config.PROVIDER_ENDPOINT,
      apiKey,
    });
    return { model: provider(cleanModelId), isAnthropic: true };
  } else {
    const apiKey = process.env[config.API_KEY_ENV] ?? "";
    console.log("[llm] Creating OpenAI provider:", {
      baseURL: config.PROVIDER_ENDPOINT,
      apiKeySet: !!apiKey,
      apiKeyLength: apiKey.length,
      modelPassedToSDK: cleanModelId,
      expectedUrl: `${config.PROVIDER_ENDPOINT}/chat/completions`,
    });
    const provider = createOpenAI({
      baseURL: config.PROVIDER_ENDPOINT,
      apiKey,
    });
    return { model: provider.chat(cleanModelId), isAnthropic: false };
  }
}

export function createVercelAILLMClient(config: Config): LLMClient {
  return {
    async chat(params: LLMChatParams): Promise<LLMResponse> {
      console.log("[llm] chat() called with:", {
        model: params.model,
        messageCount: params.messages.length,
        hasTools: !!params.tools,
        toolCount: params.tools?.length ?? 0,
        systemPromptLength: params.system?.length ?? 0,
      });

      const { model, isAnthropic } = getModelProvider(params.model, config);

      const messages = convertMessages(params.messages);

      const tools = params.tools
        ? Object.fromEntries(
            params.tools.map((t) => [
              t.name,
              {
                description: t.description,
                inputSchema: t.parameters,
              },
            ]),
          )
        : undefined;

      console.log("[llm] Tools being passed to generateText:", tools ? Object.keys(tools) : "none");
      if (tools) {
        console.log("[llm] Tool details:", Object.entries(tools).map(([name, def]) => ({
          name,
          description: (def as any).description,
          hasSchema: !!(def as any).inputSchema,
          schemaType: typeof (def as any).inputSchema,
        })));
        
        // Log the first tool's schema structure
        const firstTool = Object.entries(tools)[0];
        if (firstTool) {
          const [toolName, toolDef] = firstTool;
          console.log("[llm] First tool schema:", {
            name: toolName,
            schemaKeys: Object.keys(toolDef as any),
          });
        }
      }

      console.log("[llm] Calling generateText...");
      try {
        const result = await generateText({
          model,
          messages,
          ...(params.system ? { system: params.system } : {}),
          ...(tools ? { tools } : {}),
        });
        console.log("[llm] generateText succeeded:", {
          finishReason: result.finishReason,
          textLength: result.text?.length,
          hasReasoning: !!(result as any).reasoning,
        });

        // Handle reasoning models: extract text from reasoning if content is empty
        let responseText = result.text;
        const rawReasoning = (result as any).reasoning || (result as any).reasoning_content;
        const reasoning = typeof rawReasoning === "string" ? rawReasoning : undefined;
        if (!responseText || responseText.trim().length === 0) {
          if (reasoning) {
            console.log("[llm] Using reasoning as text:", { reasoningLength: reasoning.length });
            responseText = reasoning;
          }
        }

        const toolCalls = result.toolCalls?.length
          ? result.toolCalls.map((tc) => ({
              toolCallId: tc.toolCallId,
              toolName: tc.toolName,
              args: tc.input as Record<string, unknown>,
            }))
          : undefined;

        const message: Message = {
          role: "assistant",
          content: responseText || "",
          ...(reasoning ? { reasoning } : {}),
          ...(toolCalls ? { toolCalls } : {}),
        };

        return {
          message,
          finishReason: result.finishReason === "tool-calls" ? "tool-calls" : "stop",
          ...(toolCalls ? { toolCalls } : {}),
        };
      } catch (err) {
        console.error("[llm] generateText failed:", err);
        throw err;
      }
    },
  };
}

function convertMessages(messages: Message[]) {
  return messages.map((msg, index, arr) => {
    switch (msg.role) {
      case "system":
        return { role: "system" as const, content: msg.content };
      case "user":
        return { role: "user" as const, content: msg.content };

      case "assistant":
        if (msg.toolCalls?.length) {
          return {
            role: "assistant" as const,
            content: [
              { type: "text" as const, text: msg.content || "" },
              ...msg.toolCalls.map((tc) => ({
                type: "tool-call" as const,
                toolCallId: tc.toolCallId,
                toolName: tc.toolName,
                input: tc.args,
              })),
            ],
          };
        }
        return { role: "assistant" as const, content: msg.content };

      case "tool": {
        const toolName = findToolName(msg.toolCallId!, arr.slice(0, index));
        return {
          role: "tool" as const,
          content: [
            {
              type: "tool-result" as const,
              toolCallId: msg.toolCallId!,
              toolName: toolName ?? "unknown",
              output: {
                type: "text" as const,
                value: msg.content,
              },
            },
          ],
        };
      }
    }
  });
}

function findToolName(toolCallId: string, messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const tc = messages[i].toolCalls?.find((c) => c.toolCallId === toolCallId);
    if (tc) return tc.toolName;
  }
  return undefined;
}
