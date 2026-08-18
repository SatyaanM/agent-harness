import { createSessionData, type SessionData } from "@agent-harness/core/contracts";
import type { SessionMeta } from "@/lib/api";
import type { Message, Session } from "@/stores/session-store";

export function createTestMessage(overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? "msg-1",
    role: overrides.role ?? "user",
    content: overrides.content ?? "test message",
    createdAt: overrides.createdAt ?? "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

export function createTestSession(overrides: Partial<Session> = {}): Session {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    messages: overrides.messages ?? [],
    status: overrides.status ?? "active",
    agentName: overrides.agentName ?? "orchestrator",
    createdAt: overrides.createdAt ?? "2026-08-15T00:00:00.000Z",
    ...overrides,
  };
}

export function createTestServerSession(overrides: Partial<SessionData> = {}): SessionData {
  return createSessionData(overrides);
}

export function createTestSessionMeta(overrides: Partial<SessionMeta> = {}): SessionMeta {
  return {
    sessionId: overrides.sessionId ?? "session-1",
    prompt: overrides.prompt ?? "hello",
    createdAt: overrides.createdAt ?? "2026-08-15T00:00:00.000Z",
    updatedAt: overrides.updatedAt ?? "2026-08-15T00:00:00.000Z",
    messageCount: overrides.messageCount ?? 1,
    ...overrides,
  };
}
