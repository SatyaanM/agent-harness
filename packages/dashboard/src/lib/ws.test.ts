import { describe, expect, it, vi } from "vitest";
import { ToolEventSchema, validatedEventHandler } from "./ws";

describe("validatedEventHandler", () => {
  it("does not deliver an invalid event payload", () => {
    const handler = vi.fn();
    const onInvalid = vi.fn();
    const receive = validatedEventHandler(ToolEventSchema, "agent:tool event", handler, onInvalid);

    receive({ sessionId: "session-1", agentName: "agent", tool: { type: "unknown" } });

    expect(handler).not.toHaveBeenCalled();
    expect(onInvalid).toHaveBeenCalledOnce();
  });

  it("delivers a parsed valid event payload", () => {
    const handler = vi.fn();
    const receive = validatedEventHandler(ToolEventSchema, "agent:tool event", handler);
    const event = {
      sessionId: "session-1",
      agentName: "agent",
      tool: { type: "called", toolName: "readFile", args: { path: "README.md" } },
    };

    receive(event);

    expect(handler).toHaveBeenCalledWith(event);
  });
});
