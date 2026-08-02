import { create } from 'zustand';
import type { DelegationEvent, DelegationCompleteEvent } from '@/components/chat/DelegationCard';
import type { CouncilCreatedEvent, CouncilMessageEvent, CouncilDissolvedEvent } from '@/components/chat/CouncilCard';
import type { InboxLinkEvent } from '@/components/chat/InboxLink';

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
  role: 'user' | 'assistant' | 'system' | 'tool';
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
  status: 'active' | 'idle' | 'archived';
  agentName: string;
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
}

export interface ServerMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
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
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId ? { ...s, agentName } : s
      ),
    })),

  addMessage: (sessionId, message) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? { ...s, messages: [...s.messages, message] }
          : s
      ),
    })),

  updateMessage: (sessionId, messageId, content) =>
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.sessionId === sessionId
          ? {
              ...s,
              messages: s.messages.map((m) =>
                m.id === messageId ? { ...m, content } : m
              ),
            }
          : s
      ),
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
              status: 'active',
              agentName: data.agentName ?? 'orchestrator',
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
              }
            : s
        ),
      };
    }),
}));

function serverMessageToClient(m: ServerMessage, index: number): Message {
  const role = m.role === 'assistant' ? 'assistant' : m.role === 'user' ? 'user' : m.role === 'tool' ? 'tool' : 'system';

  let event: ChatEvent | undefined;
  const meta = m.meta as
    | { kind?: string; taskId?: string; summary?: string; status?: string }
    | undefined;
  if (meta?.kind === 'worker_completed') {
    event = {
      type: 'delegation_complete',
      taskId: meta.taskId ?? '',
      summary: meta.summary ?? '',
      status:
        meta.status === 'error'
          ? 'error'
          : meta.status === 'cancelled'
            ? 'cancelled'
            : 'done',
      timestamp: m.createdAt ? Date.parse(m.createdAt) : Date.now(),
    };
  }

  return {
    id: `srv-${index}`,
    role,
    content: m.content ?? '',
    ...(m.reasoning ? { reasoning: m.reasoning } : {}),
    ...(m.toolCalls ? { toolCalls: m.toolCalls } : {}),
    ...(m.toolCallId ? { toolCallId: m.toolCallId } : {}),
    createdAt: m.createdAt ?? '',
    ...(event ? { event } : {}),
  };
}
