import fs from "node:fs";
import path from "node:path";
import { v4 as uuidv4 } from "uuid";
import { z } from "zod";
import {
  type PendingMessage,
  PendingMessageSchema,
  type SessionData,
  SessionDataSchema,
} from "../../contracts/session.js";
import { parseJsonBoundary } from "../../validation.js";
import { MailboxRepository } from "./mailbox-repo.js";
import { MessageRepository } from "./message-repo.js";
import { OpenSessionsRepository } from "./open-sessions-repo.js";
import { SessionRepository } from "./session-repo.js";
import { TaskRepository } from "./task-repo.js";
import type { ISqliteDatabase } from "./types.js";

export interface MigrationDiagnostic {
  file: string;
  kind: "transcript" | "mailbox" | "open_sessions";
  error: string;
  quarantinePath?: string;
  timestamp: string;
}

export interface LegacyMigrationResult {
  migratedSessions: number;
  migratedMessages: number;
  migratedTasks: number;
  migratedMailboxEvents: number;
  quarantinedFiles: number;
  diagnostics: MigrationDiagnostic[];
  backupDir?: string;
  skipped: boolean;
}

const OpenSessionsFileSchema = z.array(
  z.object({
    sessionId: z.string().min(1),
    tabOrder: z.number().int().nonnegative().optional(),
    isActive: z.boolean().optional(),
  }),
);

export class LegacyMigrator {
  private readonly sessionRepo: SessionRepository;
  private readonly messageRepo: MessageRepository;
  private readonly taskRepo: TaskRepository;
  private readonly mailboxRepo: MailboxRepository;
  private readonly openSessionsRepo: OpenSessionsRepository;

  constructor(
    private readonly db: ISqliteDatabase,
    private readonly sessionsDir: string,
    private readonly harnessDir = path.join(sessionsDir, ".harness"),
  ) {
    this.sessionRepo = new SessionRepository(db);
    this.messageRepo = new MessageRepository(db);
    this.taskRepo = new TaskRepository(db);
    this.mailboxRepo = new MailboxRepository(db);
    this.openSessionsRepo = new OpenSessionsRepository(db);
  }

  migrate(): LegacyMigrationResult {
    const diagnostics: MigrationDiagnostic[] = [];

    if (!fs.existsSync(this.sessionsDir)) {
      return {
        migratedSessions: 0,
        migratedMessages: 0,
        migratedTasks: 0,
        migratedMailboxEvents: 0,
        quarantinedFiles: 0,
        diagnostics: [],
        skipped: true,
      };
    }

    // 1. Discover legacy files
    const entries = fs.readdirSync(this.sessionsDir, { withFileTypes: true });
    const transcriptFiles: string[] = [];
    const mailboxFiles: string[] = [];

    for (const entry of entries) {
      if (!entry.isFile()) continue;
      if (entry.name.endsWith(".mailbox.jsonl")) {
        mailboxFiles.push(path.join(this.sessionsDir, entry.name));
      } else if (
        entry.name.endsWith(".json") &&
        !entry.name.startsWith(".") &&
        !entry.name.includes(".invalid-")
      ) {
        transcriptFiles.push(path.join(this.sessionsDir, entry.name));
      }
    }

    const openSessionsPath = path.join(this.harnessDir, "open-sessions.json");
    const hasOpenSessions = fs.existsSync(openSessionsPath);

    if (transcriptFiles.length === 0 && mailboxFiles.length === 0 && !hasOpenSessions) {
      return {
        migratedSessions: 0,
        migratedMessages: 0,
        migratedTasks: 0,
        migratedMailboxEvents: 0,
        quarantinedFiles: 0,
        diagnostics: [],
        skipped: true,
      };
    }

    // 2. Snapshot & Pre-Migration Backup
    const now = Date.now();
    const backupDir = path.join(this.harnessDir, `legacy_backup_${now}_${uuidv4().slice(0, 8)}`);
    fs.mkdirSync(backupDir, { recursive: true });

    for (const file of transcriptFiles) {
      fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
    }
    for (const file of mailboxFiles) {
      fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
    }
    if (hasOpenSessions) {
      fs.copyFileSync(openSessionsPath, path.join(backupDir, "open-sessions.json"));
    }

    // 3. Parse, Validate & Quarantine
    const validSessions: SessionData[] = [];
    const validMailboxEvents: { sessionId: string; message: PendingMessage }[] = [];
    let quarantinedCount = 0;

    for (const filePath of transcriptFiles) {
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const parsed = parseJsonBoundary(
          SessionDataSchema,
          content,
          `legacy transcript ${path.basename(filePath)}`,
        );
        validSessions.push(parsed);
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const quarantinePath = `${filePath}.invalid-${now}-${uuidv4().slice(0, 8)}`;
        try {
          fs.renameSync(filePath, quarantinePath);
        } catch {
          // If rename fails, try copying
        }
        quarantinedCount += 1;
        diagnostics.push({
          file: path.basename(filePath),
          kind: "transcript",
          error: errorMsg,
          quarantinePath,
          timestamp: new Date(now).toISOString(),
        });
      }
    }

    for (const filePath of mailboxFiles) {
      const fileName = path.basename(filePath);
      const sessionId = fileName.replace(/\.mailbox\.jsonl$/, "");
      try {
        const content = fs.readFileSync(filePath, "utf8");
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i += 1) {
          const line = lines[i]?.trim();
          if (!line) continue;
          const parsed = parseJsonBoundary(
            PendingMessageSchema,
            line,
            `legacy mailbox ${fileName} line ${i + 1}`,
          );
          validMailboxEvents.push({ sessionId, message: parsed });
        }
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const quarantinePath = `${filePath}.invalid-${now}-${uuidv4().slice(0, 8)}`;
        try {
          fs.renameSync(filePath, quarantinePath);
        } catch {
          // Best effort quarantine
        }
        quarantinedCount += 1;
        diagnostics.push({
          file: fileName,
          kind: "mailbox",
          error: errorMsg,
          quarantinePath,
          timestamp: new Date(now).toISOString(),
        });
      }
    }

    let openSessionsData: {
      sessionId: string;
      tabOrder: number;
      isActive: boolean;
    }[] = [];
    if (hasOpenSessions) {
      try {
        const content = fs.readFileSync(openSessionsPath, "utf8");
        const parsed = parseJsonBoundary(
          OpenSessionsFileSchema,
          content,
          "legacy open-sessions.json",
        );
        openSessionsData = parsed.map((item, idx) => ({
          sessionId: item.sessionId,
          tabOrder: item.tabOrder ?? idx,
          isActive: item.isActive ?? false,
        }));
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : String(err);
        const quarantinePath = `${openSessionsPath}.invalid-${now}-${uuidv4().slice(0, 8)}`;
        try {
          fs.renameSync(openSessionsPath, quarantinePath);
        } catch {
          // best effort
        }
        quarantinedCount += 1;
        diagnostics.push({
          file: "open-sessions.json",
          kind: "open_sessions",
          error: errorMsg,
          quarantinePath,
          timestamp: new Date(now).toISOString(),
        });
      }
    }

    // 4. Relational Transformation & Atomic Batch Load
    let migratedMessagesCount = 0;
    let migratedTasksCount = 0;
    let migratedMailboxCount = 0;

    this.db.immediateTransaction(() => {
      // Import sessions and messages
      for (const session of validSessions) {
        const createdAtMs = new Date(session.createdAt).getTime();
        const completedAtMs = session.completedAt ? new Date(session.completedAt).getTime() : null;
        const updatedAtMs = completedAtMs ?? createdAtMs;

        this.sessionRepo.create({
          id: session.sessionId,
          agentName: session.agentName ?? "orchestrator",
          title: session.title ?? null,
          prompt: session.prompt,
          createdAt: Number.isNaN(createdAtMs) ? Date.now() : createdAtMs,
          updatedAt: Number.isNaN(updatedAtMs) ? Date.now() : updatedAtMs,
          completedAt: completedAtMs,
          metadata: session.result ? { result: session.result } : null,
        });

        // Insert messages
        for (let i = 0; i < session.messages.length; i += 1) {
          const msg = session.messages[i];
          if (!msg) continue;
          const msgCreatedMs = msg.createdAt
            ? new Date(msg.createdAt).getTime()
            : createdAtMs + i * 1000;

          this.messageRepo.create({
            sessionId: session.sessionId,
            role: msg.role,
            content: msg.content,
            reasoning: msg.role === "assistant" ? (msg.reasoning ?? null) : null,
            toolCalls: msg.role === "assistant" ? (msg.toolCalls ?? null) : null,
            toolCallId: msg.role === "tool" ? (msg.toolCallId ?? null) : null,
            sequenceNum: i,
            createdAt: Number.isNaN(msgCreatedMs) ? Date.now() : msgCreatedMs,
            metadata: msg.meta ? { meta: msg.meta } : null,
          });
          migratedMessagesCount += 1;
        }

        // If worker session, record in tasks table
        if (session.sessionId.startsWith("worker-")) {
          const taskId = session.taskId || session.sessionId.replace(/^worker-/, "");
          this.taskRepo.create({
            taskId,
            parentSessionId: session.sessionId, // fallback if parent unknown
            workerSessionId: session.sessionId,
            description: session.prompt,
            status:
              session.result?.status === "done"
                ? "completed"
                : session.result?.status === "cancelled"
                  ? "cancelled"
                  : session.result?.status === "error"
                    ? "failed"
                    : "completed",
            createdAt: Number.isNaN(createdAtMs) ? Date.now() : createdAtMs,
            completedAt: completedAtMs,
          });
          migratedTasksCount += 1;
        }
      }

      // Import mailbox events
      for (const item of validMailboxEvents) {
        // Ensure parent session exists
        const parent = this.sessionRepo.get(item.sessionId);
        if (!parent) {
          this.sessionRepo.create({
            id: item.sessionId,
            agentName: "orchestrator",
            prompt: "Recovered delegating session",
            createdAt: Date.now(),
          });
        }

        // Ensure task exists
        const existingTask = this.taskRepo.get(item.message.taskId);
        if (!existingTask) {
          this.taskRepo.create({
            taskId: item.message.taskId,
            parentSessionId: item.sessionId,
            description: item.message.summary,
            status:
              item.message.status === "done"
                ? "completed"
                : item.message.status === "cancelled"
                  ? "cancelled"
                  : "failed",
            createdAt: Date.now(),
          });
          migratedTasksCount += 1;
        }

        this.mailboxRepo.enqueue({
          parentSessionId: item.sessionId,
          taskId: item.message.taskId,
          eventType: "worker_completed",
          payload: item.message,
          createdAt: new Date(item.message.receivedAt).getTime() || Date.now(),
        });
        migratedMailboxCount += 1;
      }

      // Import open sessions
      if (openSessionsData.length > 0) {
        // Filter open sessions that actually exist in sessions table
        const filteredOpenSessions = openSessionsData.filter((s) =>
          Boolean(this.sessionRepo.get(s.sessionId)),
        );
        this.openSessionsRepo.setAll(filteredOpenSessions);
      }
    })();

    // 5. Post-Migration Verification & Integrity Check
    const integrity = this.db
      .prepare<[], { integrity_check: string }>("PRAGMA integrity_check;")
      .get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error(
        `Post-migration SQLite integrity check failed: ${integrity?.integrity_check}`,
      );
    }

    // Save migration diagnostics if any
    if (diagnostics.length > 0) {
      try {
        fs.writeFileSync(
          path.join(this.harnessDir, "migration_diagnostics.json"),
          JSON.stringify(diagnostics, null, 2),
          "utf8",
        );
      } catch {
        // best effort diagnostic save
      }
    }

    return {
      migratedSessions: validSessions.length,
      migratedMessages: migratedMessagesCount,
      migratedTasks: migratedTasksCount,
      migratedMailboxEvents: migratedMailboxCount,
      quarantinedFiles: quarantinedCount,
      diagnostics,
      backupDir,
      skipped: false,
    };
  }
}
