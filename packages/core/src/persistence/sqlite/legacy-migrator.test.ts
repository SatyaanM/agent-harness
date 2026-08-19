import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createDatabaseConnection } from "./db.js";
import { LegacyMigrator } from "./legacy-migrator.js";
import { MailboxRepository } from "./mailbox-repo.js";
import { MessageRepository } from "./message-repo.js";
import { SqliteMigrator } from "./migrator.js";
import { OpenSessionsRepository } from "./open-sessions-repo.js";
import { SessionRepository } from "./session-repo.js";

describe("LegacyMigrator Pipeline & Quarantine", () => {
  const tempDirs: string[] = [];

  const createTempDir = () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "harness-legacy-test-"));
    tempDirs.push(dir);
    return dir;
  };

  afterEach(() => {
    for (const dir of tempDirs) {
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        // cleanup best effort
      }
    }
    tempDirs.length = 0;
  });

  it("skips cleanly when sessions directory is empty", () => {
    const dir = createTempDir();
    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const migrator = new LegacyMigrator(db, dir);
    const result = migrator.migrate();

    expect(result.skipped).toBe(true);
    expect(result.migratedSessions).toBe(0);
    expect(result.quarantinedFiles).toBe(0);

    db.close();
  });

  it("migrates valid legacy sessions, messages, mailboxes, and open-sessions into SQLite", () => {
    const dir = createTempDir();
    const harnessDir = path.join(dir, ".harness");
    fs.mkdirSync(harnessDir, { recursive: true });

    // Create a valid legacy session file
    const session1 = {
      sessionId: "sess-legacy-1",
      taskId: "task-leg-1",
      prompt: "Legacy prompt 1",
      agentName: "orchestrator",
      messages: [
        { role: "user", content: "User legacy msg", createdAt: "2026-08-10T00:00:00.000Z" },
        {
          role: "assistant",
          content: "Assistant legacy msg",
          createdAt: "2026-08-10T00:00:01.000Z",
        },
      ],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "sess-legacy-1.json"), JSON.stringify(session1), "utf8");

    // Create a legacy mailbox file
    const mailboxLine = JSON.stringify({
      taskId: "task-mb-leg",
      from: "worker-task-mb-leg",
      agentName: "worker",
      status: "done",
      summary: "Worker completed task successfully",
      receivedAt: "2026-08-10T00:05:00.000Z",
    });
    fs.writeFileSync(path.join(dir, "sess-legacy-1.mailbox.jsonl"), `${mailboxLine}\n`, "utf8");

    // Create legacy open-sessions.json
    fs.writeFileSync(
      path.join(harnessDir, "open-sessions.json"),
      JSON.stringify([{ sessionId: "sess-legacy-1", tabOrder: 0, isActive: true }]),
      "utf8",
    );

    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const migrator = new LegacyMigrator(db, dir);
    const result = migrator.migrate();

    expect(result.skipped).toBe(false);
    expect(result.migratedSessions).toBe(1);
    expect(result.migratedMessages).toBe(2);
    expect(result.migratedMailboxEvents).toBe(1);
    expect(result.quarantinedFiles).toBe(0);

    // Verify backup created
    expect(result.backupDir).toBeDefined();
    if (result.backupDir) {
      expect(fs.existsSync(result.backupDir)).toBe(true);
      expect(fs.existsSync(path.join(result.backupDir, "sess-legacy-1.json"))).toBe(true);
      expect(fs.existsSync(path.join(result.backupDir, "sess-legacy-1.mailbox.jsonl"))).toBe(true);
    }

    // Verify SQLite relational records
    const sessionRepo = new SessionRepository(db);
    const messageRepo = new MessageRepository(db);
    const mailboxRepo = new MailboxRepository(db);
    const openSessionsRepo = new OpenSessionsRepository(db);

    const s = sessionRepo.get("sess-legacy-1");
    expect(s?.prompt).toBe("Legacy prompt 1");

    const msgs = messageRepo.listBySession("sess-legacy-1");
    expect(msgs).toHaveLength(2);
    expect(msgs[0]?.content).toBe("User legacy msg");
    expect(msgs[1]?.content).toBe("Assistant legacy msg");

    const mb = mailboxRepo.peekPending("sess-legacy-1");
    expect(mb).toHaveLength(1);
    expect(mb[0]?.task_id).toBe("task-mb-leg");

    const tabs = openSessionsRepo.getAll();
    expect(tabs).toHaveLength(1);
    expect(tabs[0]?.session_id).toBe("sess-legacy-1");

    db.close();
  });

  it("quarantines corrupted legacy files while migrating valid files successfully", () => {
    const dir = createTempDir();

    // 1. Valid file
    const validSession = {
      sessionId: "sess-valid",
      taskId: "task-valid",
      prompt: "Valid prompt",
      messages: [{ role: "user", content: "hi" }],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "sess-valid.json"), JSON.stringify(validSession), "utf8");

    // 2. Corrupted JSON file
    fs.writeFileSync(path.join(dir, "sess-corrupt.json"), "{ invalid-json-syntax-content", "utf8");

    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const migrator = new LegacyMigrator(db, dir);
    const result = migrator.migrate();

    expect(result.migratedSessions).toBe(1);
    expect(result.quarantinedFiles).toBe(1);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]?.file).toBe("sess-corrupt.json");

    // Check that valid session was imported
    const sessionRepo = new SessionRepository(db);
    expect(sessionRepo.get("sess-valid")).toBeDefined();

    // Check that corrupted file was moved to .invalid-*
    const files = fs.readdirSync(dir);
    expect(files.some((f) => f.includes("sess-corrupt.json.invalid-"))).toBe(true);

    db.close();
  });

  it("is idempotent when executed multiple times on the same data directory", () => {
    const dir = createTempDir();
    const session1 = {
      sessionId: "sess-idempotent-1",
      taskId: "task-idempotent-1",
      prompt: "Idempotent test prompt",
      messages: [{ role: "user", content: "hello world" }],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    fs.writeFileSync(path.join(dir, "sess-idempotent-1.json"), JSON.stringify(session1), "utf8");

    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const migrator = new LegacyMigrator(db, dir);
    const result1 = migrator.migrate();
    expect(result1.migratedSessions).toBe(1);
    expect(result1.migratedMessages).toBe(1);

    // Re-create the json file since first run archived/backed up or left in place
    fs.writeFileSync(path.join(dir, "sess-idempotent-1.json"), JSON.stringify(session1), "utf8");

    // Second migration should succeed without unique constraint errors
    const result2 = migrator.migrate();
    expect(result2.migratedSessions).toBe(1);

    const sessionRepo = new SessionRepository(db);
    const messageRepo = new MessageRepository(db);

    expect(sessionRepo.count()).toBe(1);
    expect(messageRepo.listBySession("sess-idempotent-1")).toHaveLength(1);

    db.close();
  });

  it("correctly resolves delegating parent session for worker sessions", () => {
    const dir = createTempDir();

    // 1. Delegating parent session
    const parentSession = {
      sessionId: "parent-session-123",
      taskId: "task-parent-123",
      agentName: "orchestrator",
      prompt: "Delegate to worker",
      messages: [
        {
          role: "user",
          content: "Please run worker task",
        },
        {
          role: "tool",
          toolCallId: "call-1",
          content: JSON.stringify({
            taskId: "worker-task-abc",
            sessionId: "worker-worker-task-abc",
          }),
        },
      ],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(dir, "parent-session-123.json"),
      JSON.stringify(parentSession),
      "utf8",
    );

    // 2. Worker session
    const workerSession = {
      sessionId: "worker-worker-task-abc",
      taskId: "worker-task-abc",
      agentName: "worker",
      prompt: "Subagent worker prompt",
      messages: [{ role: "assistant", content: "Worker result" }],
      result: { status: "done", summary: "Worker completed successfully" },
      createdAt: "2026-08-10T00:01:00.000Z",
      completedAt: "2026-08-10T00:02:00.000Z",
    };
    fs.writeFileSync(
      path.join(dir, "worker-worker-task-abc.json"),
      JSON.stringify(workerSession),
      "utf8",
    );

    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const migrator = new LegacyMigrator(db, dir);
    migrator.migrate();

    const sessionRepo = new SessionRepository(db);
    expect(sessionRepo.get("parent-session-123")).toBeDefined();
    expect(sessionRepo.get("worker-worker-task-abc")).toBeDefined();

    const taskStmt = db.prepare<
      [string],
      { task_id: string; parent_session_id: string; worker_session_id: string }
    >("SELECT task_id, parent_session_id, worker_session_id FROM tasks WHERE task_id = ?");
    const task = taskStmt.get("worker-task-abc");

    expect(task).toBeDefined();
    expect(task?.parent_session_id).toBe("parent-session-123");
    expect(task?.worker_session_id).toBe("worker-worker-task-abc");

    db.close();
  });

  it("preserves genuine parent session metadata when worker session is processed first", () => {
    const dir = createTempDir();

    // 1. Worker session named with 'a-' so it sorts earlier in directory listing
    const workerSession = {
      sessionId: "worker-task-early",
      taskId: "task-early",
      agentName: "worker",
      prompt: "Early worker task",
      messages: [{ role: "assistant", content: "Result" }],
      createdAt: "2026-08-10T00:01:00.000Z",
    };
    fs.writeFileSync(
      path.join(dir, "a-worker-task-early.json"),
      JSON.stringify(workerSession),
      "utf8",
    );

    // 2. Real parent session named with 'z-'
    const parentSession = {
      sessionId: "z-parent-orchestrator",
      taskId: "task-parent",
      agentName: "orchestrator",
      title: "Real Parent Session Title",
      prompt: "Real Parent Session Prompt",
      messages: [
        {
          role: "tool",
          toolCallId: "call-early",
          content: JSON.stringify({ taskId: "task-early" }),
        },
      ],
      createdAt: "2026-08-10T00:00:00.000Z",
    };
    fs.writeFileSync(
      path.join(dir, "z-parent-orchestrator.json"),
      JSON.stringify(parentSession),
      "utf8",
    );

    const db = createDatabaseConnection(":memory:");
    new SqliteMigrator(db).up();

    const migrator = new LegacyMigrator(db, dir);
    const result = migrator.migrate();

    expect(result.migratedSessions).toBe(2);

    const sessionRepo = new SessionRepository(db);
    const parent = sessionRepo.get("z-parent-orchestrator");
    expect(parent).toBeDefined();
    expect(parent?.title).toBe("Real Parent Session Title");
    expect(parent?.prompt).toBe("Real Parent Session Prompt");

    // Verify files marked as .migrated
    expect(fs.existsSync(path.join(dir, "a-worker-task-early.json.migrated"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "z-parent-orchestrator.json.migrated"))).toBe(true);

    // Second run should be skipped
    const secondResult = migrator.migrate();
    expect(secondResult.skipped).toBe(true);

    db.close();
  });
});
