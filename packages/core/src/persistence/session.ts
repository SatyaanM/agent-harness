import fs from "fs-extra";
import path from "path";
import type { Message, TaskId } from "../agent/types.js";

export interface PendingMessage {
  taskId: TaskId;
  from: string;
  agentName: string;
  status: "done" | "error" | "cancelled";
  summary: string;
  receivedAt: string;
}

export interface SessionData {
  sessionId: string;
  taskId: TaskId;
  prompt: string;
  messages: Message[];
  agentName?: string;
  mailbox?: PendingMessage[];
  result?: {
    status: string;
    summary: string;
  };
  createdAt: string;
  completedAt?: string;
}

function stripToolCallXml(content: string): string {
  let cleaned = content;
  
  const toolCallStart = "<" + "tool_call>";
  const toolCallEnd = "</" + "tool_call>";
  while (true) {
    const startIdx = cleaned.indexOf(toolCallStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolCallEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolCallEnd.length);
  }
  
  const toolResultStart = "<" + "tool_result>";
  const toolResultEnd = "</" + "tool_result>";
  while (true) {
    const startIdx = cleaned.indexOf(toolResultStart);
    if (startIdx === -1) break;
    const endIdx = cleaned.indexOf(toolResultEnd, startIdx);
    if (endIdx === -1) break;
    cleaned = cleaned.slice(0, startIdx) + cleaned.slice(endIdx + toolResultEnd.length);
  }
  
  return cleaned.trim();
}

function cleanMessages(messages: Message[]): Message[] {
  return messages.map((msg) => {
    if (msg.content && typeof msg.content === "string") {
      return { ...msg, content: stripToolCallXml(msg.content) };
    }
    return msg;
  });
}

export class SessionStore {
  private sessionsDir: string;

  constructor(sessionsDir: string) {
    this.sessionsDir = sessionsDir;
    fs.ensureDirSync(this.sessionsDir);
  }

  async save(session: SessionData): Promise<string> {
    const filePath = path.join(this.sessionsDir, `${session.sessionId}.json`);
    await fs.writeJson(filePath, session, { spaces: 2 });
    return filePath;
  }

  async load(sessionId: string): Promise<SessionData | null> {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (await fs.pathExists(filePath)) {
      const session = await fs.readJson(filePath);
      return { ...session, messages: cleanMessages(session.messages || []) };
    }
    return null;
  }

  async list(): Promise<SessionData[]> {
    const files = await fs.readdir(this.sessionsDir);
    const sessions: SessionData[] = [];
    for (const file of files) {
      if (file.endsWith(".json")) {
        const session = await fs.readJson(path.join(this.sessionsDir, file));
        sessions.push({ ...session, messages: cleanMessages(session.messages || []) });
      }
    }
    return sessions.sort(
      (a, b) =>
        new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
    );
  }

  async delete(sessionId: string): Promise<void> {
    const filePath = path.join(this.sessionsDir, `${sessionId}.json`);
    if (await fs.pathExists(filePath)) {
      await fs.remove(filePath);
    }
  }
}
