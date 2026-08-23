import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { LLMClient, LLMResponse } from "../llm/client.js";
import { SqliteDatabaseDriver } from "../persistence/sqlite/db.js";
import { MessageRepository } from "../persistence/sqlite/message-repo.js";
import { SqliteMigrator } from "../persistence/sqlite/migrator.js";
import { Compactor, estimateMessagesTokens, estimateTokens } from "./compactor.js";

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
    if (!call.messages[0]) throw new Error("No messages");
    expect(call.messages[0].content).toContain("[Message 1] Role: user");
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
});
