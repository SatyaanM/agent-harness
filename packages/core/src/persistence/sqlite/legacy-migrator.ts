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

type LegacyMailboxEvent = { sessionId: string; message: PendingMessage };
type OpenSessionData = { sessionId: string; tabOrder: number; isActive: boolean };

interface LegacyFiles {
  transcriptFiles: string[];
  mailboxFiles: string[];
  openSessionsPath: string;
  hasOpenSessions: boolean;
}

interface ParsedLegacyData {
  validSessions: SessionData[];
  validMailboxEvents: LegacyMailboxEvent[];
  openSessionsData: OpenSessionData[];
  diagnostics: MigrationDiagnostic[];
  quarantinedCount: number;
}

interface MigrationCounts {
  migratedMessages: number;
  migratedTasks: number;
  migratedMailboxEvents: number;
}

function skippedMigrationResult(): LegacyMigrationResult {
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

function quarantineLegacyFile(
  filePath: string,
  file: string,
  kind: MigrationDiagnostic["kind"],
  error: unknown,
  now: number,
  diagnostics: MigrationDiagnostic[],
): void {
  const errorMsg = error instanceof Error ? error.message : String(error);
  const quarantinePath = `${filePath}.invalid-${now}-${uuidv4().slice(0, 8)}`;
  try {
    fs.renameSync(filePath, quarantinePath);
  } catch {
    try {
      fs.copyFileSync(filePath, quarantinePath);
      fs.unlinkSync(filePath);
    } catch {
      // best effort quarantine
    }
  }
  diagnostics.push({
    file,
    kind,
    error: errorMsg,
    quarantinePath,
    timestamp: new Date(now).toISOString(),
  });
}

function migrationSessionStatus(status: string | undefined): "completed" | "cancelled" | "failed" {
  return status === "done"
    ? "completed"
    : status === "cancelled"
      ? "cancelled"
      : status === "error"
        ? "failed"
        : "completed";
}

function migrationMailboxStatus(status: string | undefined): "completed" | "cancelled" | "failed" {
  return status === "done" ? "completed" : status === "cancelled" ? "cancelled" : "failed";
}

function discoverLegacyFiles(sessionsDir: string, harnessDir: string): LegacyFiles | undefined {
  if (!fs.existsSync(sessionsDir)) return undefined;

  const transcriptFiles: string[] = [];
  const mailboxFiles: string[] = [];
  for (const entry of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(".mailbox.jsonl")) {
      mailboxFiles.push(path.join(sessionsDir, entry.name));
    } else if (
      entry.name.endsWith(".json") &&
      !entry.name.startsWith(".") &&
      !entry.name.includes(".invalid-")
    ) {
      transcriptFiles.push(path.join(sessionsDir, entry.name));
    }
  }

  const openSessionsPath = path.join(harnessDir, "open-sessions.json");
  const hasOpenSessions = fs.existsSync(openSessionsPath);
  if (transcriptFiles.length === 0 && mailboxFiles.length === 0 && !hasOpenSessions) {
    return undefined;
  }
  return { transcriptFiles, mailboxFiles, openSessionsPath, hasOpenSessions };
}

function backupLegacyFiles(files: LegacyFiles, backupDir: string): void {
  for (const file of files.transcriptFiles) {
    fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
  }
  for (const file of files.mailboxFiles) {
    fs.copyFileSync(file, path.join(backupDir, path.basename(file)));
  }
  if (files.hasOpenSessions) {
    fs.copyFileSync(files.openSessionsPath, path.join(backupDir, "open-sessions.json"));
  }
}

function parseTranscriptFile(
  filePath: string,
  now: number,
  diagnostics: MigrationDiagnostic[],
): SessionData | undefined {
  try {
    return parseJsonBoundary(
      SessionDataSchema,
      fs.readFileSync(filePath, "utf8"),
      `legacy transcript ${path.basename(filePath)}`,
    );
  } catch (error) {
    quarantineLegacyFile(filePath, path.basename(filePath), "transcript", error, now, diagnostics);
    return undefined;
  }
}

function parseMailboxFile(
  filePath: string,
  now: number,
  diagnostics: MigrationDiagnostic[],
  events: LegacyMailboxEvent[],
): void {
  const fileName = path.basename(filePath);
  const sessionId = fileName.replace(/\.mailbox\.jsonl$/, "");
  try {
    const lines = fs.readFileSync(filePath, "utf8").split("\n");
    for (let i = 0; i < lines.length; i += 1) {
      const line = lines[i]?.trim();
      if (!line) continue;
      const message = parseJsonBoundary(
        PendingMessageSchema,
        line,
        `legacy mailbox ${fileName} line ${i + 1}`,
      );
      events.push({ sessionId, message });
    }
  } catch (error) {
    quarantineLegacyFile(filePath, fileName, "mailbox", error, now, diagnostics);
  }
}

function parseOpenSessionsFile(
  filePath: string,
  now: number,
  diagnostics: MigrationDiagnostic[],
): OpenSessionData[] {
  try {
    const parsed = parseJsonBoundary(
      OpenSessionsFileSchema,
      fs.readFileSync(filePath, "utf8"),
      "legacy open-sessions.json",
    );
    return parsed.map((item, index) => ({
      sessionId: item.sessionId,
      tabOrder: item.tabOrder ?? index,
      isActive: item.isActive ?? false,
    }));
  } catch (error) {
    quarantineLegacyFile(filePath, "open-sessions.json", "open_sessions", error, now, diagnostics);
    return [];
  }
}

function parseLegacyFiles(files: LegacyFiles, now: number): ParsedLegacyData {
  const diagnostics: MigrationDiagnostic[] = [];
  const validSessions = files.transcriptFiles
    .map((filePath) => parseTranscriptFile(filePath, now, diagnostics))
    .filter((session): session is SessionData => session !== undefined);
  const validMailboxEvents: LegacyMailboxEvent[] = [];
  for (const filePath of files.mailboxFiles) {
    parseMailboxFile(filePath, now, diagnostics, validMailboxEvents);
  }
  const openSessionsData = files.hasOpenSessions
    ? parseOpenSessionsFile(files.openSessionsPath, now, diagnostics)
    : [];
  return {
    validSessions,
    validMailboxEvents,
    openSessionsData,
    diagnostics,
    quarantinedCount: diagnostics.length,
  };
}

function buildTaskParentMap(
  validSessions: readonly SessionData[],
  validMailboxEvents: readonly LegacyMailboxEvent[],
): Map<string, string> {
  const taskParentMap = new Map<string, string>();
  for (const item of validMailboxEvents) {
    taskParentMap.set(item.message.taskId, item.sessionId);
  }
  for (const session of validSessions) {
    for (const mailbox of session.mailbox ?? []) {
      if (typeof mailbox.taskId === "string") taskParentMap.set(mailbox.taskId, session.sessionId);
    }
    for (const message of session.messages) {
      if (message.role !== "tool" || !message.content?.includes("taskId")) continue;
      try {
        const parsed = parseJsonBoundary(
          z.object({ taskId: z.string().min(1) }),
          message.content,
          "tool result taskId extract",
        );
        taskParentMap.set(parsed.taskId, session.sessionId);
      } catch {
        // ignore non-matching tool contents
      }
    }
  }
  return taskParentMap;
}

function renameMigratedFiles(files: LegacyFiles): void {
  const paths = [
    ...files.transcriptFiles,
    ...files.mailboxFiles,
    ...(files.hasOpenSessions ? [files.openSessionsPath] : []),
  ];
  for (const file of paths) {
    try {
      if (fs.existsSync(file)) fs.renameSync(file, `${file}.migrated`);
    } catch {
      // best effort
    }
  }
}

function writeMigrationDiagnostics(
  harnessDir: string,
  diagnostics: readonly MigrationDiagnostic[],
): void {
  if (diagnostics.length === 0) return;
  try {
    fs.writeFileSync(
      path.join(harnessDir, "migration_diagnostics.json"),
      JSON.stringify(diagnostics, null, 2),
      "utf8",
    );
  } catch {
    // best effort diagnostic save
  }
}

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
    const files = discoverLegacyFiles(this.sessionsDir, this.harnessDir);
    if (!files) return skippedMigrationResult();

    const now = Date.now();
    const backupDir = path.join(this.harnessDir, `legacy_backup_${now}_${uuidv4().slice(0, 8)}`);
    fs.mkdirSync(backupDir, { recursive: true });
    backupLegacyFiles(files, backupDir);

    const parsed = parseLegacyFiles(files, now);
    const taskParentMap = buildTaskParentMap(parsed.validSessions, parsed.validMailboxEvents);
    const counts = this.migrateDatabase(
      parsed.validSessions,
      parsed.validMailboxEvents,
      parsed.openSessionsData,
      taskParentMap,
    );

    this.verifyIntegrity();
    renameMigratedFiles(files);
    writeMigrationDiagnostics(this.harnessDir, parsed.diagnostics);

    return {
      migratedSessions: parsed.validSessions.length,
      ...counts,
      quarantinedFiles: parsed.quarantinedCount,
      diagnostics: parsed.diagnostics,
      backupDir,
      skipped: false,
    };
  }

  private migrateDatabase(
    validSessions: readonly SessionData[],
    validMailboxEvents: readonly LegacyMailboxEvent[],
    openSessionsData: readonly OpenSessionData[],
    taskParentMap: ReadonlyMap<string, string>,
  ): MigrationCounts {
    const counts: MigrationCounts = {
      migratedMessages: 0,
      migratedTasks: 0,
      migratedMailboxEvents: 0,
    };
    this.db.immediateTransaction(() => {
      this.importSessionRoots(validSessions);
      const sessionCounts = this.importSessionData(validSessions, taskParentMap);
      const mailboxCounts = this.importMailboxEvents(validMailboxEvents);
      this.importOpenSessions(openSessionsData);
      counts.migratedMessages = sessionCounts.migratedMessages;
      counts.migratedTasks = sessionCounts.migratedTasks + mailboxCounts.migratedTasks;
      counts.migratedMailboxEvents = mailboxCounts.migratedMailboxEvents;
    })();
    return counts;
  }

  private importSessionRoots(sessions: readonly SessionData[]): void {
    for (const session of sessions) {
      const createdAtMs = new Date(session.createdAt).getTime();
      const completedAtMs = session.completedAt ? new Date(session.completedAt).getTime() : null;
      const updatedAtMs = completedAtMs ?? createdAtMs;
      if (this.sessionRepo.get(session.sessionId)) continue;
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
    }
  }

  private importSessionData(
    sessions: readonly SessionData[],
    taskParentMap: ReadonlyMap<string, string>,
  ): Pick<MigrationCounts, "migratedMessages" | "migratedTasks"> {
    let migratedMessages = 0;
    let migratedTasks = 0;
    for (const session of sessions) {
      migratedMessages += this.importMessages(session);
      if (this.importWorkerTask(session, sessions, taskParentMap)) migratedTasks += 1;
    }
    return { migratedMessages, migratedTasks };
  }

  private importMessages(session: SessionData): number {
    const createdAtMs = new Date(session.createdAt).getTime();
    const existingMessages = this.messageRepo.listBySession(session.sessionId);
    const existingSeqNums = new Set(existingMessages.map((message) => message.sequence_num));
    let migratedMessages = 0;
    for (let i = 0; i < session.messages.length; i += 1) {
      if (existingSeqNums.has(i)) continue;
      const message = session.messages[i];
      if (!message) continue;
      const messageCreatedMs = message.createdAt
        ? new Date(message.createdAt).getTime()
        : createdAtMs + i * 1000;
      this.messageRepo.create({
        ...(message.role === "user" && message.deliveryId ? { id: message.deliveryId } : {}),
        sessionId: session.sessionId,
        role: message.role,
        content: message.content,
        reasoning: message.role === "assistant" ? (message.reasoning ?? null) : null,
        toolCalls: message.role === "assistant" ? (message.toolCalls ?? null) : null,
        toolCallId: message.role === "tool" ? (message.toolCallId ?? null) : null,
        sequenceNum: i,
        createdAt: Number.isNaN(messageCreatedMs) ? Date.now() : messageCreatedMs,
        metadata: message.meta ? { meta: message.meta } : null,
      });
      migratedMessages += 1;
    }
    return migratedMessages;
  }

  private importWorkerTask(
    session: SessionData,
    sessions: readonly SessionData[],
    taskParentMap: ReadonlyMap<string, string>,
  ): boolean {
    if (!session.sessionId.startsWith("worker-")) return false;
    const taskId = session.taskId || session.sessionId.replace(/^worker-/, "");
    const parentSessionId = this.resolveWorkerParent(session, sessions, taskId, taskParentMap);
    this.ensureRecoveredSession(parentSessionId);
    if (this.taskRepo.get(taskId)) return false;

    const createdAtMs = new Date(session.createdAt).getTime();
    const completedAtMs = session.completedAt ? new Date(session.completedAt).getTime() : null;
    this.taskRepo.create({
      taskId,
      parentSessionId,
      workerSessionId: session.sessionId,
      description: session.prompt,
      status: migrationSessionStatus(session.result?.status),
      createdAt: Number.isNaN(createdAtMs) ? Date.now() : createdAtMs,
      completedAt: completedAtMs,
    });
    return true;
  }

  private resolveWorkerParent(
    session: SessionData,
    sessions: readonly SessionData[],
    taskId: string,
    taskParentMap: ReadonlyMap<string, string>,
  ): string {
    const mappedParent =
      taskParentMap.get(taskId) ?? taskParentMap.get(session.sessionId.replace(/^worker-/, ""));
    if (mappedParent) return mappedParent;
    const existingTask = this.taskRepo.get(taskId);
    if (existingTask) return existingTask.parent_session_id;
    const nonWorker = sessions.find((candidate) => !candidate.sessionId.startsWith("worker-"));
    return nonWorker?.sessionId ?? session.sessionId;
  }

  private ensureRecoveredSession(sessionId: string): void {
    if (this.sessionRepo.get(sessionId)) return;
    this.sessionRepo.create({
      id: sessionId,
      agentName: "orchestrator",
      prompt: "Recovered delegating session",
      createdAt: Date.now(),
    });
  }

  private importMailboxEvents(
    events: readonly LegacyMailboxEvent[],
  ): Pick<MigrationCounts, "migratedTasks" | "migratedMailboxEvents"> {
    let migratedTasks = 0;
    let migratedMailboxEvents = 0;
    for (const event of events) {
      const counts = this.importMailboxEvent(event);
      migratedTasks += counts.migratedTasks;
      migratedMailboxEvents += counts.migratedMailboxEvents;
    }
    return { migratedTasks, migratedMailboxEvents };
  }

  private importMailboxEvent(
    event: LegacyMailboxEvent,
  ): Pick<MigrationCounts, "migratedTasks" | "migratedMailboxEvents"> {
    this.ensureRecoveredSession(event.sessionId);
    let migratedTasks = 0;
    if (!this.taskRepo.get(event.message.taskId)) {
      this.taskRepo.create({
        taskId: event.message.taskId,
        parentSessionId: event.sessionId,
        description: event.message.summary,
        status: migrationMailboxStatus(event.message.status),
        createdAt: Date.now(),
      });
      migratedTasks = 1;
    }

    const alreadyPending = this.mailboxRepo
      .peekPending(event.sessionId)
      .some((pending) => pending.task_id === event.message.taskId);
    if (alreadyPending) return { migratedTasks, migratedMailboxEvents: 0 };
    this.mailboxRepo.enqueue({
      parentSessionId: event.sessionId,
      taskId: event.message.taskId,
      eventType: "worker_completed",
      payload: event.message,
      createdAt: new Date(event.message.receivedAt).getTime() || Date.now(),
    });
    return { migratedTasks, migratedMailboxEvents: 1 };
  }

  private importOpenSessions(openSessions: readonly OpenSessionData[]): void {
    if (openSessions.length === 0) return;
    const filteredOpenSessions = openSessions.filter((session) =>
      Boolean(this.sessionRepo.get(session.sessionId)),
    );
    this.openSessionsRepo.upsertAll(filteredOpenSessions);
  }

  private verifyIntegrity(): void {
    const integrity = this.db
      .prepare<[], { integrity_check: string }>("PRAGMA integrity_check;")
      .get();
    if (integrity?.integrity_check !== "ok") {
      throw new Error(
        `Post-migration SQLite integrity check failed: ${integrity?.integrity_check}`,
      );
    }
  }
}
