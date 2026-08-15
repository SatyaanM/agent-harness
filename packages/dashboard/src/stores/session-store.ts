import { z } from "zod";
import { create } from "zustand";
import type {
  CouncilCreatedEvent,
  CouncilDissolvedEvent,
  CouncilMessageEvent,
} from "@/components/chat/CouncilCard";
import type { DelegationCompleteEvent, DelegationEvent } from "@/components/chat/DelegationCard";
import type { InboxLinkEvent } from "@/components/chat/InboxLink";

const WorkerCompletedMetaSchema = z
  .object({
    kind: z.literal("worker_completed"),
    taskId: z.string().optional(),
    summary: z.string().optional(),
    status: z.enum(["done", "error", "cancelled"]).optional(),
  })
  .passthrough();

export type ChatEvent =
  | DelegationEvent
  | DelegationCompleteEvent
  | CouncilCreatedEvent
  | CouncilMessageEvent
  | CouncilDissolvedEvent
  | InboxLinkEvent;

export interface ClientToolCall {
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
}

export interface Message {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  reasoning?: string;
  toolCalls?: ClientToolCall[];
  toolCallId?: string;
  createdAt: string;
  event?: ChatEvent;
}

export interface Session {
  sessionId: string;
  messages: Message[];
  status: "active" | "idle" | "archived";
  agentName: string;
  title?: string;
  createdAt: string;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  addSession: (session: Session) => void;
  setActiveSession: (sessionId: string) => void;
  setAgentName: (sessionId: string, agentName: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, content: string) => void;
  syncFromServer: (data: ServerSession) => void;
  hydrate: (sessions: ServerSession[]) => void;
  removeSession: (sessionId: string) => void;
  renameSession: (sessionId: string, title?: string) => void;
}

export interface ServerMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  reasoning?: string;
  toolCalls?: ClientToolCall[];
  toolCallId?: string;
  createdAt?: string;
  meta?: unknown;
}

export interface ServerSession {
  sessionId: string;
  agentName?: string;
  title?: string;
  createdAt?: string;
  messages: ServerMessage[];
}

export const useSessionStore = create<SessionStore>((set) => ({
  sessions: [],
  activeSessionId: null,

  addSession: (session) =>
    set((state) => ({
      sessions: [...state.sessions, session],
      activeSessionId: session.sessionId,
    })),

  setActiveSession: (sessionId) => set({ activeSessionId: sessionId }),

  setAgentName: (sessionId, agentName) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.sessionId === sessionId ? { ...s, agentName } : s)),
    })),

  addMessage: (sessionId, message) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, messages: [...s.messages, message] } : s,
      ),
    })),

  updateMessage: (sessionId, messageId, content) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) => (m.id === messageId ? { ...m, content } : m)),
            }
          : s,
      ),
    })),

  hydrate: (serverSessions) =>
    set({
      sessions: serverSessions.map((data) => {
        const messages = data.messages.map((m, i) => serverMessageToClient(m, i));
        return {
          sessionId: data.sessionId,
          messages,
          status: "active",
          agentName: data.agentName ?? "orchestrator",
          title: data.title,
          createdAt: data.createdAt ?? new Date().toISOString(),
        };
      }),
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = state.sessions.filter((s) => s.sessionId !== sessionId);
      let activeSessionId = state.activeSessionId;
      if (activeSessionId === sessionId) {
        const idx = state.sessions.findIndex((s) => s.sessionId === sessionId);
        const neighbor = state.sessions[idx + 1] ?? state.sessions[idx - 1];
        activeSessionId = neighbor?.sessionId ?? null;
      }
      return { sessions, activeSessionId };
    }),

  renameSession: (sessionId, title) =>
    set((state) => ({
      sessions: state.sessions.map((s) => (s.sessionId === sessionId ? { ...s, title } : s)),
    })),

  syncFromServer: (data) =>
    set((state) => {
      const messages = data.messages.map((m, i) => serverMessageToClient(m, i));
      const existing = state.sessions.find((s) => s.sessionId === data.sessionId);
      if (!existing) {
        return {
          sessions: [
            ...state.sessions,
            {
              sessionId: data.sessionId,
              messages,
              status: "active",
              agentName: data.agentName ?? "orchestrator",
              title: data.title,
              createdAt: data.createdAt ?? new Date().toISOString(),
            },
          ],
        };
      }
      return {
        sessions: state.sessions.map((s) =>
          s.sessionId === data.sessionId
            ? {
                ...s,
                messages,
                agentName: data.agentName ?? s.agentName,
                title: data.title,
              }
            : s,
        ),
      };
    }),
}));

function serverMessageToClient(m: ServerMessage, index: number): Message {
  const role =
    m.role === "assistant"
      ? "assistant"
      : m.role === "user"
        ? "user"
        : m.role === "tool"
          ? "tool"
          : "system";

  let event: ChatEvent | undefined;
  const meta = WorkerCompletedMetaSchema.safeParse(m.meta);
  if (meta.success) {
    event = {
      type: "delegation_complete",
      taskId: meta.data.taskId ?? "",
      summary: meta.data.summary ?? "",
      status:
        meta.data.status === "error"
          ? "error"
          : meta.data.status === "cancelled"
            ? "cancelled"
            : "done",
      timestamp: m.createdAt ? Date.parse(m.createdAt) : Date.now(),
    };
  }

  return {
    id: `srv-${index}`,
    role,
    content: m.content ?? "",
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    createdAt: m.createdAt ?? "",
    ...(event ? { event } : {}),
  };
}
