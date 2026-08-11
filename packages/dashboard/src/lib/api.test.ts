import { BoundaryValidationError } from "@agent-harness/core/contracts";
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchOpenSessions, parseChatStreamEvent } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("chat stream boundary", () => {
  it("parses known stream events and rejects malformed events", () => {
    expect(parseChatStreamEvent('{"type":"text-delta","text":"hello"}')).toEqual({
      type: "text-delta",
      text: "hello",
    });
    expect(() => parseChatStreamEvent('{"type":"text-delta","text":42}')).toThrow(
      BoundaryValidationError,
    );
  });
});

describe("dashboard API boundary", () => {
  it("rejects an invalid JSON response before returning it to stores", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json({ activeSessionId: null, openSessionIds: ["valid", 42] })),
    );

    await expect(fetchOpenSessions()).rejects.toBeInstanceOf(BoundaryValidationError);
  });
});
