import { describe, expect, it } from "vitest";
import { MessageSchema } from "../agent/types.js";
import { LLMResponseSchema } from "./client.js";

describe("LLMResponseSchema", () => {
  it("rejects unsupported provider finish reasons", () => {
    expect(
      LLMResponseSchema.safeParse({
        message: { role: "assistant", content: "done" },
        finishReason: "unknown",
      }).success,
    ).toBe(false);
  });

  it("rejects oversized provider tool arguments", () => {
    expect(
      LLMResponseSchema.safeParse({
        message: { role: "assistant", content: "" },
        finishReason: "tool-calls",
        toolCalls: [
          {
            toolCallId: "call-1",
            toolName: "tool",
            args: { value: "x".repeat(1_000_001) },
          },
        ],
      }).success,
    ).toBe(false);
  });

  it("requires role-coherent message fields", () => {
    expect(MessageSchema.safeParse({ role: "tool", content: "result" }).success).toBe(false);
    expect(
      MessageSchema.safeParse({
        role: "user",
        content: "hello",
        reasoning: "not allowed",
      }).success,
    ).toBe(false);
    expect(
      MessageSchema.safeParse({
        role: "tool",
        content: "result",
        toolCallId: "call-1",
      }).success,
    ).toBe(true);
  });

  it("rejects finish reasons that disagree with tool calls", () => {
    const toolCalls = [{ toolCallId: "call-1", toolName: "tool", args: {} }];
    expect(
      LLMResponseSchema.safeParse({
        message: { role: "assistant", content: "" },
        finishReason: "stop",
        toolCalls,
      }).success,
    ).toBe(false);
    expect(
      LLMResponseSchema.safeParse({
        message: { role: "assistant", content: "" },
        finishReason: "tool-calls",
      }).success,
    ).toBe(false);
  });
});
