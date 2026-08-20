import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { Agent } from "../agent/agent.js";
import { createDelegateTool } from "../agent/delegation.js";
import { CapabilityRegistry } from "../capability/registry.js";
import {
  type ISpan,
  type ITraceContext,
  type ITracer,
  resetGlobalTracer,
  type SpanAttributes,
  type SpanLink,
  type SpanOptions,
  SpanStatusCode,
  setGlobalTracer,
} from "../contracts/tracing.js";
import type { LLMClient } from "../llm/client.js";
import { SqliteDatabaseDriver } from "../persistence/sqlite/db.js";
import { SqliteMigrator } from "../persistence/sqlite/migrator.js";
import { SessionRepository } from "../persistence/sqlite/session-repo.js";
import { ToolRegistry } from "../tool/registry.js";

class RecordingSpan implements ISpan {
  public ended = false;
  public status?: { code: SpanStatusCode; message?: string };
  public exceptions: unknown[] = [];
  public events: { name: string; attributes?: SpanAttributes }[] = [];

  constructor(
    public readonly name: string,
    public readonly options: SpanOptions | undefined,
    public readonly parentContext: ITraceContext | undefined,
    public readonly attributes: Record<string, unknown> = {
      ...(options?.attributes ?? {}),
    },
    public readonly links: readonly SpanLink[] = options?.links ?? [],
  ) {}

  spanContext(): ITraceContext {
    return {
      traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
      spanId: "00f067aa0ba902b7",
      traceFlags: 1,
    };
  }

  setAttribute(key: string, value: unknown): this {
    this.attributes[key] = value;
    return this;
  }

  setAttributes(attributes: SpanAttributes): this {
    Object.assign(this.attributes, attributes);
    return this;
  }

  addEvent(name: string, attributes?: SpanAttributes): this {
    this.events.push({ name, attributes });
    return this;
  }

  setStatus(status: { code: SpanStatusCode; message?: string }): this {
    this.status = status;
    return this;
  }

  recordException(exception: unknown): this {
    this.exceptions.push(exception);
    return this;
  }

  end(): void {
    this.ended = true;
  }

  isRecording(): boolean {
    return true;
  }
}

class TestTracer implements ITracer {
  public readonly spans: RecordingSpan[] = [];
  private activeContext: ITraceContext | undefined = undefined;

  startSpan(name: string, options?: SpanOptions, parentContext?: ITraceContext): ISpan {
    const span = new RecordingSpan(name, options, parentContext ?? this.activeContext);
    this.spans.push(span);
    return span;
  }

  async withSpan<T>(span: ISpan, fn: (span: ISpan) => Promise<T> | T): Promise<T> {
    const prevContext = this.activeContext;
    this.activeContext = span.spanContext();
    try {
      return await fn(span);
    } finally {
      this.activeContext = prevContext;
    }
  }

  currentContext(): ITraceContext | undefined {
    return this.activeContext;
  }

  currentSpan(): ISpan | undefined {
    return undefined;
  }
}

describe("Distributed Span Instrumentation", () => {
  let tracer: TestTracer;

  beforeEach(() => {
    tracer = new TestTracer();
    setGlobalTracer(tracer);
  });

  afterEach(() => {
    resetGlobalTracer();
  });

  it("creates agent.run, agent.step, gen_ai.chat and tool.execute spans during execution", async () => {
    const tools = new ToolRegistry();
    tools.register({
      name: "echo_tool",
      description: "Echo input",
      parameters: z.object({ text: z.string() }),
      execute: async ({ text }: { text: string }) => `Echo: ${text}`,
    });

    let turn = 0;
    const mockLlm: LLMClient = {
      chat: async () => {
        turn += 1;
        if (turn === 1) {
          return {
            message: { role: "assistant", content: "" },
            toolCalls: [
              {
                toolCallId: "call_1",
                toolName: "echo_tool",
                args: { text: "hello" },
              },
            ],
            finishReason: "tool-calls",
            usage: { inputTokens: 15, outputTokens: 10, totalTokens: 25 },
          };
        }
        return {
          message: { role: "assistant", content: "Final answer" },
          finishReason: "stop",
          usage: { inputTokens: 30, outputTokens: 5, totalTokens: 35 },
        };
      },
    };

    const agent = new Agent(
      {
        name: "test-agent",
        model: "mock-model",
        instructions: "Be helpful",
        tools: ["echo_tool"],
        maxSteps: 5,
      },
      tools,
      mockLlm,
      new CapabilityRegistry({ workspaceRoot: ":memory:" }),
    );

    const result = await agent.run("Hello");
    expect(result.status).toBe("success");
    expect(result.summary).toBe("Final answer");

    const spanNames = tracer.spans.map((s) => s.name);
    expect(spanNames).toContain("agent.run");
    expect(spanNames).toContain("agent.step");
    expect(spanNames).toContain("gen_ai.chat");
    expect(spanNames).toContain("tool.execute: echo_tool");

    const llmSpan = tracer.spans.find((s) => s.name === "gen_ai.chat");
    expect(llmSpan?.attributes["gen_ai.usage.input_tokens"]).toBe(15);
    expect(llmSpan?.ended).toBe(true);

    const runSpan = tracer.spans.find((s) => s.name === "agent.run");
    expect(runSpan?.status?.code).toBe(SpanStatusCode.OK);
    expect(runSpan?.ended).toBe(true);
  });

  it("links worker background spans across delegation boundaries", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "spans-test-"));
    const driver = new SqliteDatabaseDriver(":memory:");
    const migrator = new SqliteMigrator(driver);
    migrator.up();

    const sessionRepo = new SessionRepository(driver);
    sessionRepo.create({
      id: "parent_session",
      agentName: "orchestrator",
      prompt: "Main user task",
      createdAt: Date.now(),
    });

    const tools = new ToolRegistry();
    let workerSpawned = false;

    const mockLlm: LLMClient = {
      chat: async () => ({
        message: { role: "assistant", content: "Worker finished task" },
        finishReason: "stop",
      }),
    };

    const delegateTool = createDelegateTool({
      sessionsDir: tmpDir,
      db: driver,
      sessionId: "parent_session",
      resolveConfig: () => ({
        name: "test_worker",
        model: "mock-model",
        instructions: "Do work",
        tools: [],
        maxSteps: 3,
      }),
      toolRegistry: tools,
      llmClient: mockLlm,
      capabilityRegistry: new CapabilityRegistry({ workspaceRoot: ":memory:" }),
      onWorkerSpawned: () => {
        workerSpawned = true;
      },
    });

    const rootSpan = tracer.startSpan("parent.run");
    await tracer.withSpan(rootSpan, async () => {
      await delegateTool.execute({ task: "Background computation" });
    });
    rootSpan.end();

    expect(workerSpawned).toBe(true);

    // Wait a tick for worker promise to execute
    await new Promise((resolve) => setTimeout(resolve, 50));

    const workerSpan = tracer.spans.find((s) => s.name === "worker.run");
    expect(workerSpan).toBeDefined();
    expect(workerSpan?.links.length).toBeGreaterThan(0);
    expect(workerSpan?.links[0]?.context.traceId).toBe("4bf92f3577b34da6a3ce929d0e0e4736");

    driver.close();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
