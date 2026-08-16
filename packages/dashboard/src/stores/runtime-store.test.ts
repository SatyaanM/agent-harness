import { beforeEach, describe, expect, it } from "vitest";
import { MAX_TOOL_ACTIVITY_PER_SESSION, useRuntimeStore } from "./runtime-store";

beforeEach(() => {
  useRuntimeStore.setState({ activity: {}, running: {} });
});

describe("runtime activity retention", () => {
  it("bounds activity retained for each session", () => {
    for (let index = 0; index <= MAX_TOOL_ACTIVITY_PER_SESSION; index++) {
      useRuntimeStore.getState().record("session", {
        id: String(index),
        agentName: "agent",
        toolName: "tool",
        type: "called",
        timestamp: index,
      });
    }

    const activity = useRuntimeStore.getState().activity.session ?? [];
    expect(activity).toHaveLength(MAX_TOOL_ACTIVITY_PER_SESSION);
    expect(activity[0]?.id).toBe("1");
  });
});
