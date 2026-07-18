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

export interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  createdAt: string;
  event?: ChatEvent;
}

export interface Session {
  sessionId: string;
  messages: Message[];
  status: 'active' | 'idle' | 'archived';
  createdAt: string;
}

interface SessionStore {
  sessions: Session[];
  activeSessionId: string | null;
  addSession: (session: Session) => void;
  setActiveSession: (sessionId: string) => void;
  addMessage: (sessionId: string, message: Message) => void;
  updateMessage: (sessionId: string, messageId: string, content: string) => void;
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
}));
