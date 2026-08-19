import { describe, expect, it } from "vitest";
import { withDbRetry } from "./concurrency.js";
import { createDatabaseConnection } from "./db.js";
import { MailboxRepository } from "./mailbox-repo.js";
import { MessageRepository } from "./message-repo.js";
import { SqliteMigrator } from "./migrator.js";
import { SessionRepository } from "./session-repo.js";
import { TaskRepository } from "./task-repo.js";

describe("Fault Injection & ACID Durability Guarantees", () => {
  it("leaves zero uncommitted messages and preserves pending mailbox state on crash mid-drain", () => {
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const sessionRepo = new SessionRepository(db);
    const taskRepo = new TaskRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    const messageRepo = new MessageRepository(db);

    sessionRepo.create({
      id: "sess-crash",
      agentName: "orchestrator",
      prompt: "main prompt",
    });

    taskRepo.create({
      taskId: "task-crash-1",
      parentSessionId: "sess-crash",
      description: "crash test task 1",
    });

    taskRepo.create({
      taskId: "task-crash-2",
      parentSessionId: "sess-crash",
      description: "crash test task 2",
    });

    mailboxRepo.enqueue({
      parentSessionId: "sess-crash",
      taskId: "task-crash-1",
      payload: { taskId: "task-crash-1", summary: "result 1" },
    });

    mailboxRepo.enqueue({
      parentSessionId: "sess-crash",
      taskId: "task-crash-2",
      payload: { taskId: "task-crash-2", summary: "result 2" },
    });

    expect(mailboxRepo.countPending("sess-crash")).toBe(2);

    // Simulate crash / fatal error mid-transaction
    expect(() => {
      db.immediateTransaction(() => {
        const pending = mailboxRepo.peekPending("sess-crash");
        const first = pending[0];
        if (first) {
          messageRepo.create({
            sessionId: "sess-crash",
            role: "system",
            content: "Materialized first event",
          });
          mailboxRepo.acknowledge(first.id);
        }

        // Simulate abrupt failure (e.g. out of memory, network disconnect, power failure)
        throw new Error("FATAL_SIMULATED_PROCESS_CRASH_MID_DRAIN");
      })();
    }).toThrow("FATAL_SIMULATED_PROCESS_CRASH_MID_DRAIN");

    // ACID Guarantee: All changes must be rolled back
    expect(mailboxRepo.countPending("sess-crash")).toBe(2);
    expect(messageRepo.listBySession("sess-crash")).toHaveLength(0);

    const pendingAfter = mailboxRepo.peekPending("sess-crash");
    expect(pendingAfter.every((e) => e.status === "pending")).toBe(true);

    db.close();
  });

  it("retries transient database lock contention with jittered backoff", () => {
    let attempts = 0;
    const result = withDbRetry(
      () => {
        attempts += 1;
        if (attempts < 3) {
          throw new Error("SQLITE_BUSY: database is locked");
        }
        return "success_after_retries";
      },
      { initialDelayMs: 2, maxDelayMs: 20, maxRetries: 5 },
    );

    expect(result).toBe("success_after_retries");
    expect(attempts).toBe(3);
  });

  it("propagates non-retryable errors immediately without retrying", () => {
    let attempts = 0;
    expect(() => {
      withDbRetry(() => {
        attempts += 1;
        throw new Error("FOREIGN KEY constraint failed");
      });
    }).toThrow("FOREIGN KEY constraint failed");

    expect(attempts).toBe(1);
  });
});
