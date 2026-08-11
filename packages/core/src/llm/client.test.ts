import { describe, expect, it } from "vitest";
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
});
