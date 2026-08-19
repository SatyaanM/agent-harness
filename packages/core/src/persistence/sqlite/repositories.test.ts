import { beforeEach, describe, expect, it } from "vitest";
import { createDatabaseConnection } from "./db.js";
import { MailboxRepository } from "./mailbox-repo.js";
import { MessageRepository } from "./message-repo.js";
import { SqliteMigrator } from "./migrator.js";
import { OpenSessionsRepository } from "./open-sessions-repo.js";
import { RunRepository } from "./run-repo.js";
import { SessionRepository } from "./session-repo.js";
import { TaskRepository } from "./task-repo.js";
import type { ISqliteDatabase } from "./types.js";

describe("Relational Repositories & Data Access Layer", () => {
  let db: ISqliteDatabase;
  let sessionRepo: SessionRepository;
  let runRepo: RunRepository;
  let msgRepo: MessageRepository;
  let taskRepo: TaskRepository;
  let mailboxRepo: MailboxRepository;
  let openSessionsRepo: OpenSessionsRepository;

  beforeEach(() => {
    db = createDatabaseConnection(":memory:");
    const migrator = new SqliteMigrator(db);
    migrator.up();

    sessionRepo = new SessionRepository(db);
    runRepo = new RunRepository(db);
    msgRepo = new MessageRepository(db);
    taskRepo = new TaskRepository(db);
    mailboxRepo = new MailboxRepository(db);
    openSessionsRepo = new OpenSessionsRepository(db);
  });

  describe("SessionRepository", () => {
    it("creates, reads, updates, and deletes sessions", () => {
      const created = sessionRepo.create({
        id: "sess-1",
        agentName: "orchestrator",
        title: "Test Session",
        prompt: "Hello AI",
        metadata: { customField: "value123" },
      });

      expect(created.id).toBe("sess-1");
      expect(created.agent_name).toBe("orchestrator");
      expect(created.title).toBe("Test Session");

      const fetched = sessionRepo.get("sess-1");
      expect(fetched).toBeDefined();
      expect(fetched?.prompt).toBe("Hello AI");
      expect(fetched?.metadata).toBe(JSON.stringify({ customField: "value123" }));

      const updated = sessionRepo.update("sess-1", {
        title: "Updated Title",
        completedAt: 123456789,
      });
      expect(updated).toBe(true);

      const refetched = sessionRepo.get("sess-1");
      expect(refetched?.title).toBe("Updated Title");
      expect(refetched?.completed_at).toBe(123456789);

      const deleted = sessionRepo.delete("sess-1");
      expect(deleted).toBe(true);
      expect(sessionRepo.get("sess-1")).toBeUndefined();
    });

    it("lists session metadata with correct message counts", () => {
      sessionRepo.create({
        id: "sess-1",
        agentName: "orchestrator",
        title: "Session 1",
        prompt: "Prompt 1",
      });
      sessionRepo.create({
        id: "sess-2",
        agentName: "worker",
        title: "Session 2",
        prompt: "Prompt 2",
      });

      msgRepo.create({
        sessionId: "sess-1",
        role: "user",
        content: "msg 1",
      });
      msgRepo.create({
        sessionId: "sess-1",
        role: "assistant",
        content: "msg 2",
      });

      const metaAll = sessionRepo.listMeta();
      expect(metaAll).toHaveLength(2);

      const sess1Meta = metaAll.find((m) => m.id === "sess-1");
      expect(sess1Meta?.messageCount).toBe(2);

      const sess2Meta = metaAll.find((m) => m.id === "sess-2");
      expect(sess2Meta?.messageCount).toBe(0);

      const workerMeta = sessionRepo.listMeta({ agentName: "worker" });
      expect(workerMeta).toHaveLength(1);
      expect(workerMeta[0]?.id).toBe("sess-2");
    });
  });

  describe("RunRepository", () => {
    it("creates, queries, and updates runs", () => {
      sessionRepo.create({
        id: "sess-run",
        agentName: "orchestrator",
        prompt: "run test",
      });

      const run = runRepo.create({
        runId: "run-101",
        sessionId: "sess-run",
        status: "queued",
        model: "claude-3-7-sonnet",
      });

      expect(run.run_id).toBe("run-101");
      expect(run.status).toBe("queued");

      const fetched = runRepo.get("run-101");
      expect(fetched?.model).toBe("claude-3-7-sonnet");

      runRepo.update("run-101", {
        status: "completed",
        completedAt: Date.now(),
        tokenUsage: { promptTokens: 100, completionTokens: 50, totalTokens: 150 },
      });

      const completed = runRepo.get("run-101");
      expect(completed?.status).toBe("completed");
      expect(completed?.token_usage).toContain("150");

      const runsForSession = runRepo.listBySession("sess-run");
      expect(runsForSession).toHaveLength(1);
    });
  });

  describe("MessageRepository", () => {
    it("maintains strict monotonic sequence numbers", () => {
      sessionRepo.create({
        id: "sess-msg",
        agentName: "orchestrator",
        prompt: "msg test",
      });

      const msg0 = msgRepo.create({
        sessionId: "sess-msg",
        role: "user",
        content: "First message",
      });
      expect(msg0.sequence_num).toBe(0);

      const msg1 = msgRepo.create({
        sessionId: "sess-msg",
        role: "assistant",
        content: "Second message",
      });
      expect(msg1.sequence_num).toBe(1);

      const msg2 = msgRepo.create({
        sessionId: "sess-msg",
        role: "system",
        content: "Third message",
      });
      expect(msg2.sequence_num).toBe(2);

      const messages = msgRepo.listBySession("sess-msg");
      expect(messages).toHaveLength(3);
      expect(messages[0]?.sequence_num).toBe(0);
      expect(messages[1]?.sequence_num).toBe(1);
      expect(messages[2]?.sequence_num).toBe(2);

      const after0 = msgRepo.listBySession("sess-msg", { afterSequenceNum: 0 });
      expect(after0).toHaveLength(2);
      expect(after0[0]?.sequence_num).toBe(1);
    });
  });

  describe("TaskRepository", () => {
    it("tracks background worker tasks and updates status", () => {
      sessionRepo.create({
        id: "parent-sess",
        agentName: "orchestrator",
        prompt: "parent prompt",
      });
      sessionRepo.create({
        id: "worker-sess",
        agentName: "worker",
        prompt: "worker prompt",
      });

      const task = taskRepo.create({
        taskId: "task-001",
        parentSessionId: "parent-sess",
        workerSessionId: "worker-sess",
        description: "Background research task",
        status: "running",
      });

      expect(task.task_id).toBe("task-001");
      expect(task.status).toBe("running");

      const byWorker = taskRepo.getByWorkerSession("worker-sess");
      expect(byWorker?.task_id).toBe("task-001");

      const runningTasks = taskRepo.listByStatus(["running", "queued"]);
      expect(runningTasks).toHaveLength(1);

      taskRepo.update("task-001", {
        status: "completed",
        completedAt: Date.now(),
      });

      const updatedTask = taskRepo.get("task-001");
      expect(updatedTask?.status).toBe("completed");
    });
  });

  describe("MailboxRepository", () => {
    it("enqueues, peeks, acknowledges, and drains mailbox events", () => {
      sessionRepo.create({
        id: "parent-mb",
        agentName: "orchestrator",
        prompt: "mb prompt",
      });
      taskRepo.create({
        taskId: "task-mb-1",
        parentSessionId: "parent-mb",
        description: "mb task 1",
      });
      taskRepo.create({
        taskId: "task-mb-2",
        parentSessionId: "parent-mb",
        description: "mb task 2",
      });

      mailboxRepo.enqueue({
        parentSessionId: "parent-mb",
        taskId: "task-mb-1",
        eventType: "worker_completed",
        payload: { summary: "Task 1 completed successfully" },
      });

      mailboxRepo.enqueue({
        parentSessionId: "parent-mb",
        taskId: "task-mb-2",
        eventType: "worker_completed",
        payload: { summary: "Task 2 completed successfully" },
      });

      expect(mailboxRepo.countPending("parent-mb")).toBe(2);

      const pending = mailboxRepo.peekPending("parent-mb");
      expect(pending).toHaveLength(2);
      expect(pending[0]?.task_id).toBe("task-mb-1");
      expect(pending[1]?.task_id).toBe("task-mb-2");

      const drained = mailboxRepo.drainPendingEvents("parent-mb");
      expect(drained).toHaveLength(2);
      expect(mailboxRepo.countPending("parent-mb")).toBe(0);
    });
  });

  describe("OpenSessionsRepository", () => {
    it("tracks tab order and active session projection", () => {
      sessionRepo.create({ id: "tab-1", agentName: "agent", prompt: "p1" });
      sessionRepo.create({ id: "tab-2", agentName: "agent", prompt: "p2" });
      sessionRepo.create({ id: "tab-3", agentName: "agent", prompt: "p3" });

      openSessionsRepo.add("tab-1", 0, true);
      openSessionsRepo.add("tab-2", 1, false);
      openSessionsRepo.add("tab-3", 2, false);

      const allTabs = openSessionsRepo.getAll();
      expect(allTabs).toHaveLength(3);
      expect(allTabs[0]?.session_id).toBe("tab-1");
      expect(allTabs[0]?.is_active).toBe(1);

      openSessionsRepo.setActive("tab-2");
      const updatedTabs = openSessionsRepo.getAll();
      const tab1 = updatedTabs.find((t) => t.session_id === "tab-1");
      const tab2 = updatedTabs.find((t) => t.session_id === "tab-2");
      expect(tab1?.is_active).toBe(0);
      expect(tab2?.is_active).toBe(1);

      openSessionsRepo.remove("tab-1");
      expect(openSessionsRepo.getAll()).toHaveLength(2);
    });
  });

  describe("Foreign Key Cascades", () => {
    it("cascades session deletion to child runs, messages, tasks, and open session records", () => {
      sessionRepo.create({ id: "cascade-sess", agentName: "agent", prompt: "cascade" });
      runRepo.create({ runId: "c-run", sessionId: "cascade-sess", status: "completed" });
      msgRepo.create({ sessionId: "cascade-sess", role: "user", content: "hello" });
      taskRepo.create({ taskId: "c-task", parentSessionId: "cascade-sess", description: "desc" });
      mailboxRepo.enqueue({
        parentSessionId: "cascade-sess",
        taskId: "c-task",
        payload: { test: true },
      });
      openSessionsRepo.add("cascade-sess", 0, true);

      // Verify all children exist
      expect(runRepo.get("c-run")).toBeDefined();
      expect(msgRepo.listBySession("cascade-sess")).toHaveLength(1);
      expect(taskRepo.get("c-task")).toBeDefined();
      expect(mailboxRepo.peekPending("cascade-sess")).toHaveLength(1);
      expect(openSessionsRepo.getAll()).toHaveLength(1);

      // Delete parent session
      sessionRepo.delete("cascade-sess");

      // Verify all children were cascaded deleted
      expect(runRepo.get("c-run")).toBeUndefined();
      expect(msgRepo.listBySession("cascade-sess")).toHaveLength(0);
      expect(taskRepo.get("c-task")).toBeUndefined();
      expect(mailboxRepo.peekPending("cascade-sess")).toHaveLength(0);
      expect(openSessionsRepo.getAll()).toHaveLength(0);
    });
  });
});
