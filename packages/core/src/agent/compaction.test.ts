import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMClient, LLMResponse } from "../llm/client.js";
import { SqliteDatabaseDriver } from "../persistence/sqlite/db.js";
import { MessageRepository } from "../persistence/sqlite/message-repo.js";
import { SqliteMigrator } from "../persistence/sqlite/migrator.js";
import {
  Compactor,
  estimateMessagesTokens,
  estimateTokens,
  MAX_COMPACTION_INPUT_CHARACTERS,
  MAX_COMPACTION_OUTPUT_TOKENS,
} from "./compactor.js";

describe("Compactor Engine and SQLite Repo", () => {
  let db: SqliteDatabaseDriver;
  let messageRepo: MessageRepository;
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "compactor-test-"));
    db = new SqliteDatabaseDriver(join(tempDir, "test.db"));
    const migrator = new SqliteMigrator(db);
    migrator.up();

    // Add required dependencies for messages table (sessions, runs)
    db.exec(`
      INSERT INTO sessions (id, agent_name, prompt, created_at, updated_at)
      VALUES ('sess-1', 'test-agent', 'test', 0, 0);
    `);

    messageRepo = new MessageRepository(db);
  });

  afterEach(() => {
    db.close();
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("identifies token count accurately", () => {
    expect(estimateTokens("hello world")).toBe(3);
  });

  it("compacts messages via LLM Client", async () => {
    const mockResponse: LLMResponse = {
      message: { role: "assistant", content: "Extracted facts: ...\n\nSummary of earlier events." },
      finishReason: "stop",
    };
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue(mockResponse),
    };

    const compactor = new Compactor(mockClient);

    const messages = [
      { role: "user" as const, content: "hi" },
      { role: "assistant" as const, content: "hello" },
    ];

    const result = await compactor.compact(messages, "gpt-4");
    expect(result.summary).toBe(mockResponse.message.content);
    expect(result.summaryTokenEstimate).toBeGreaterThan(0);
    expect(result.originalTokenEstimate).toBe(estimateMessagesTokens(messages));

    expect(mockClient.chat).toHaveBeenCalledTimes(1);
    const call = vi.mocked(mockClient.chat).mock.calls[0]?.[0];
    if (!call) throw new Error("No call");
    expect(call.model).toBe("gpt-4");
    expect(call.maxOutputTokens).toBe(MAX_COMPACTION_OUTPUT_TOKENS);
    if (!call.messages[0]) throw new Error("No messages");
    expect(call.messages[0].content).toContain("[Message 1] Role: user");
  });

  it("bounds the provider-only projection without changing source messages", async () => {
    const source = "x".repeat(MAX_COMPACTION_INPUT_CHARACTERS * 2);
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "bounded summary" },
        finishReason: "stop",
      }),
    };

    await new Compactor(mockClient).compact([{ role: "user", content: source }], "model");

    const request = vi.mocked(mockClient.chat).mock.calls[0]?.[0];
    expect(request?.messages[0]?.content.length).toBeLessThanOrEqual(
      MAX_COMPACTION_INPUT_CHARACTERS,
    );
    expect(request?.messages[0]?.content).toContain("[truncated");
    expect(source).toHaveLength(MAX_COMPACTION_INPUT_CHARACTERS * 2);
  });

  it("fits an oversized tool result within a small context and output capability", async () => {
    const oversizedResult = "r".repeat(100_000);
    const mockClient: LLMClient = {
      chat: vi.fn().mockResolvedValue({
        message: { role: "assistant", content: "bounded summary" },
        finishReason: "stop",
      }),
    };

    await new Compactor(mockClient).compact(
      [
        {
          role: "assistant",
          content: "",
          toolCalls: [{ toolCallId: "call-1", toolName: "lookup", args: {} }],
        },
        { role: "tool", content: oversizedResult, toolCallId: "call-1" },
      ],
      "small-model",
      { contextWindowTokens: 8_000, maxOutputTokens: 512 },
    );

    const request = vi.mocked(mockClient.chat).mock.calls[0]?.[0];
    expect(request?.maxOutputTokens).toBe(512);
    expect(request?.messages[0]?.content.length).toBeLessThanOrEqual(27_904);
    expect(request?.messages[0]?.content).toContain("[truncated");
    expect(oversizedResult).toHaveLength(100_000);
  });

  it.each([
    [
      "empty",
      { message: { role: "assistant" as const, content: "   " }, finishReason: "stop" as const },
    ],
    [
      "length-truncated",
      {
        message: { role: "assistant" as const, content: "partial" },
        finishReason: "length" as const,
      },
    ],
    [
      "content-filtered",
      {
        message: { role: "assistant" as const, content: "filtered" },
        finishReason: "content-filter" as const,
      },
    ],
    [
      "provider-error",
      { message: { role: "assistant" as const, content: "error" }, finishReason: "error" as const },
    ],
    [
      "tool-calling",
      {
        message: {
          role: "assistant" as const,
          content: "call a tool",
          toolCalls: [{ toolCallId: "call-1", toolName: "lookup", args: {} }],
        },
        finishReason: "tool-calls" as const,
      },
    ],
  ])("rejects an unusable %s response", async (_name, response) => {
    const client: LLMClient = { chat: vi.fn().mockResolvedValue(response) };
    await expect(
      new Compactor(client).compact([{ role: "user", content: "source" }], "model"),
    ).rejects.toThrow(/compaction response/i);
  });

  it("substitutes ranges dynamically in getActiveContext", () => {
    for (let i = 0; i < 5; i++) {
      messageRepo.create({
        id: `msg-${i}`,
        sessionId: "sess-1",
        role: "user",
        content: `test ${i}`,
        sequenceNum: i,
        createdAt: 1000 + i,
      });
    }

    messageRepo.create({
      id: "summary-1",
      sessionId: "sess-1",
      role: "system",
      content: "SUMMARY_TEXT",
      sequenceNum: 5,
      createdAt: 1005,
    });

    messageRepo.recordCompaction({
      sessionId: "sess-1",
      summaryMessageId: "summary-1",
      startSequence: 1,
      endSequence: 3,
      originalTokenEstimate: 10,
      summaryTokenEstimate: 5,
      compactedAt: 1006,
      modelUsed: "mock",
    });

    const activeContext = messageRepo.getActiveContext("sess-1");

    expect(activeContext.length).toBe(3);
    if (!activeContext[0]) throw new Error();
    expect(activeContext[0].content).toBe("test 0");
    if (!activeContext[1]) throw new Error();
    expect(activeContext[1].content).toBe("SUMMARY_TEXT");
    if (!activeContext[2]) throw new Error();
    expect(activeContext[2].content).toBe("test 4");

    const all = messageRepo.listBySession("sess-1");
    expect(all.length).toBe(6);
  });

  it("rejects duplicate, overlapping, invalid, and cross-session compaction records", () => {
    db.exec(`
      INSERT INTO sessions (id, agent_name, prompt, created_at, updated_at)
      VALUES ('sess-2', 'test-agent', 'test', 0, 0);
    `);
    for (let i = 0; i < 6; i++) {
      messageRepo.create({
        id: `source-${i}`,
        sessionId: "sess-1",
        role: "user",
        content: `source ${i}`,
        sequenceNum: i,
      });
    }
    messageRepo.create({
      id: "summary-valid",
      sessionId: "sess-1",
      role: "system",
      content: "summary",
      sequenceNum: 6,
    });
    messageRepo.create({
      id: "summary-cross-session",
      sessionId: "sess-2",
      role: "system",
      content: "summary",
      sequenceNum: 0,
    });

    const valid = {
      sessionId: "sess-1",
      summaryMessageId: "summary-valid",
      startSequence: 0,
      endSequence: 2,
      originalTokenEstimate: 12,
      summaryTokenEstimate: 3,
      compactedAt: 100,
      modelUsed: "mock",
    };
    messageRepo.recordCompaction(valid);
    expect(() => messageRepo.recordCompaction(valid)).toThrow();
    expect(() =>
      messageRepo.recordCompaction({
        ...valid,
        summaryMessageId: "source-5",
        startSequence: 2,
        endSequence: 4,
      }),
    ).toThrow();
    expect(() =>
      messageRepo.recordCompaction({ ...valid, startSequence: 3, endSequence: 3 }),
    ).toThrow();
    expect(() =>
      messageRepo.recordCompaction({ ...valid, summaryMessageId: "summary-cross-session" }),
    ).toThrow();
  });

  it("reconstructs active context beyond ten thousand transcript rows", () => {
    db.immediateTransaction(() => {
      for (let i = 0; i < 10_050; i++) {
        messageRepo.create({
          id: `long-${i}`,
          sessionId: "sess-1",
          role: "user",
          content: String(i),
          sequenceNum: i,
        });
      }
    })();

    const active = messageRepo.getActiveContext("sess-1");
    expect(active).toHaveLength(10_050);
    expect(active.at(-1)?.content).toBe("10049");
  });

  it("never splits an assistant tool call from its matching tool results", () => {
    messageRepo.create({
      id: "user-0",
      sessionId: "sess-1",
      role: "user",
      content: "start",
      sequenceNum: 0,
    });
    messageRepo.create({
      id: "assistant-tools",
      sessionId: "sess-1",
      role: "assistant",
      content: "",
      toolCalls: [
        { toolCallId: "call-1", toolName: "one", args: {} },
        { toolCallId: "call-2", toolName: "two", args: {} },
      ],
      sequenceNum: 1,
    });
    for (const [index, toolCallId] of ["call-1", "call-2"].entries()) {
      messageRepo.create({
        id: `tool-${index}`,
        sessionId: "sess-1",
        role: "tool",
        content: `result ${index}`,
        toolCallId,
        sequenceNum: index + 2,
      });
    }
    messageRepo.create({
      id: "assistant-final",
      sessionId: "sess-1",
      role: "assistant",
      content: "done",
      sequenceNum: 4,
    });
    messageRepo.create({
      id: "user-recent",
      sessionId: "sess-1",
      role: "user",
      content: "recent",
      sequenceNum: 5,
    });

    expect(
      messageRepo
        .selectCompactionCandidate("sess-1", { keepRecentMessages: 2, chunkMessages: 2 })
        .map((row) => row.id),
    ).toEqual([]);
    expect(
      messageRepo
        .selectCompactionCandidate("sess-1", { keepRecentMessages: 2, chunkMessages: 4 })
        .map((row) => row.id),
    ).toEqual(["user-0", "assistant-tools", "tool-0", "tool-1"]);
    expect(
      messageRepo
        .selectCompactionCandidate("sess-1", { keepRecentMessages: 3, chunkMessages: 4 })
        .map((row) => row.id),
    ).toEqual([]);
  });
});
