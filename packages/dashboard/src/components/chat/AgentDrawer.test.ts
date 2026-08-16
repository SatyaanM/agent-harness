import { describe, expect, it } from "vitest";
import { shouldPollWorker } from "./AgentDrawer";

describe("worker transcript polling", () => {
  it("polls only a running worker", () => {
    expect(shouldPollWorker("worker", "running")).toBe(true);
    expect(shouldPollWorker("worker", "done")).toBe(false);
    expect(shouldPollWorker("worker", "error")).toBe(false);
    expect(shouldPollWorker("worker", "cancelled")).toBe(false);
    expect(shouldPollWorker("primary", "running")).toBe(false);
  });
});
