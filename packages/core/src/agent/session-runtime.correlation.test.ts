import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { CapabilityRegistry } from "../capability/registry.js";
import type { LLMChatParams, LLMClient, LLMResponse } from "../llm/client.js";
import { ToolRegistry } from "../tool/registry.js";
import { SessionRuntime, type SessionRuntimeEvent } from "./session-runtime.js";
import type { AgentConfig } from "./types.js";

const tempDirs: string[] = [];

async function makeDirectory(): Promise<string> {
  const dir = await mkdtemp(path.join(tmpdir(), "agent-harness-correlation-"));
  tempDirs.push(dir);
  return dir;
}

function stop(content: string): LLMResponse {
  return { finishReason: "stop", message: { role: "assistant", content } };
}

function isEventType<T extends SessionRuntimeEvent["type"]>(
  event: SessionRuntimeEvent,
  type: T,
): event is Extract<SessionRuntimeEvent, { type: T }> {
  return event.type === type;
}

afterEach(async () => {
  await Promise.all(
    tempDirs
      .splice(0)
      .map((dir) => rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 })),
  );
});

describe("SessionRuntime run correlation", () => {
  function buildRuntime(
    sessionsDir: string,
    onEvent: (event: SessionRuntimeEvent) => void,
  ): SessionRuntime {
    const llmClient: LLMClient = {
      chat: vi.fn(async (_params: LLMChatParams) => stop("done")),
    };
    const config = (): AgentConfig => ({
      name: "orchestrator",
      model: "fake",
      tools: [],
      maxSteps: 2,
      instructions: "test",
    });
    return new SessionRuntime({
      sessionId: "corr",
      sessionsDir,
      resolveConfig: config,
      toolRegistry: new ToolRegistry(),
      llmClient,
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      onEvent,
    });
  }

  it("attaches a fresh runId and the requestId to agent lifecycle events", async () => {
    const sessionsDir = await makeDirectory();
    const events: SessionRuntimeEvent[] = [];
    const runtime = buildRuntime(sessionsDir, (event) => events.push(event));

    await runtime.deliver("hi", undefined, undefined, "req-123");

    const started = events.find((event) => isEventType(event, "agent:started"));
    const completed = events.find((event) => isEventType(event, "agent:completed"));

    expect(started).toBeDefined();
    expect(started?.requestId).toBe("req-123");
    expect(started?.runId).toMatch(/^[0-9a-f-]{36}$/);
    expect(completed).toBeDefined();
    expect(completed?.requestId).toBe("req-123");
    // One run identity shared across the lifecycle of a single delivery.
    expect(completed?.runId).toBe(started?.runId);
  });

  it("omits requestId when no request context is provided", async () => {
    const sessionsDir = await makeDirectory();
    const events: SessionRuntimeEvent[] = [];
    const runtime = buildRuntime(sessionsDir, (event) => events.push(event));

    await runtime.deliver("hi");

    const started = events.find((event) => isEventType(event, "agent:started"));
    expect(started?.requestId).toBeUndefined();
    expect(started?.runId).toBeDefined();
  });

  it("generates a distinct runId per delivery", async () => {
    const sessionsDir = await makeDirectory();
    const events: SessionRuntimeEvent[] = [];
    const runtime = buildRuntime(sessionsDir, (event) => events.push(event));

    await runtime.deliver("first");
    await runtime.deliver("second");

    const started = events
      .filter((event) => isEventType(event, "agent:started"))
      .map((event) => event.runId);
    expect(new Set(started).size).toBe(2);
  });

  it("carries an error code on agent:error events", async () => {
    const sessionsDir = await makeDirectory();
    const events: SessionRuntimeEvent[] = [];
    const llmClient: LLMClient = {
      chat: vi.fn(async (_params: LLMChatParams) => {
        throw new Error("provider unavailable");
      }),
    };
    const config = (): AgentConfig => ({
      name: "orchestrator",
      model: "fake",
      tools: [],
      maxSteps: 2,
      instructions: "test",
    });
    const runtime = new SessionRuntime({
      sessionId: "corr-err",
      sessionsDir,
      resolveConfig: config,
      toolRegistry: new ToolRegistry(),
      llmClient,
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: sessionsDir }),
      onEvent: (event) => events.push(event),
    });

    await expect(runtime.deliver("hi")).rejects.toThrow("provider unavailable");

    const errorEvent = events.find((event) => isEventType(event, "agent:error"));
    expect(errorEvent).toBeDefined();
    expect(errorEvent?.error).toBe("provider unavailable");
    expect(errorEvent?.code).toBe("Error");
    expect(errorEvent?.runId).toMatch(/^[0-9a-f-]{36}$/);
  });
});
