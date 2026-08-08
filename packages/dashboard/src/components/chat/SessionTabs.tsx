'use client';

import { useState } from 'react';
import { useSessionStore, type Message } from '@/stores/session-store';
import { useReopenSessionStore } from '@/stores/reopen-session-store';
import { createSession, openSession, renameSession } from '@/lib/api';
import AgentPicker from './AgentPicker';

function tabLabel(session: {
  title?: string;
  sessionId: string;
  messages: Message[];
}): string {
  if (session.title?.trim()) return session.title;
  const firstUser = session.messages.find((m) => m.role === 'user')?.content?.trim();
  if (firstUser) return firstUser.length > 24 ? `${firstUser.slice(0, 24)}…` : firstUser;
  return `Session ${session.sessionId.slice(0, 6)}`;
}

export default function SessionTabs() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addSession = useSessionStore((s) => s.addSession);
  const removeSession = useSessionStore((s) => s.removeSession);
  const renameSessionStore = useSessionStore((s) => s.renameSession);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editValue, setEditValue] = useState('');

  const handleNewSession = async () => {
    try {
      const session = await createSession();
      addSession({
        sessionId: session.sessionId,
        messages: [],
        status: 'active',
        agentName: session.agentName ?? 'orchestrator',
        title: session.title,
        createdAt: new Date().toISOString(),
      });
      openSession(session.sessionId).catch(() => undefined);
    } catch {
      const id = crypto.randomUUID();
      addSession({
        sessionId: id,
        messages: [],
        status: 'active',
        agentName: 'orchestrator',
        createdAt: new Date().toISOString(),
      });
    }
  };

  const startRename = (sessionId: string, title?: string) => {
    setEditingId(sessionId);
    setEditValue(title ?? '');
  };

  const commitRename = async (sessionId: string) => {
    const value = editValue.trim();
    setEditingId(null);
    try {
      await renameSession(sessionId, value);
      renameSessionStore(sessionId, value === '' ? undefined : value);
    } catch {
      // Keep the old label; a failed rename is non-critical.
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950">
      {sessions.map((session) => (
        <div key={session.sessionId} className="group flex items-center">
          {editingId === session.sessionId ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={() => commitRename(session.sessionId)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitRename(session.sessionId);
                if (e.key === 'Escape') setEditingId(null);
              }}
              className="w-32 rounded border border-blue-400 bg-transparent px-2 py-1 text-sm focus:outline-none"
            />
          ) : (
            <button
              onClick={() => setActiveSession(session.sessionId)}
              onDoubleClick={() => startRename(session.sessionId, session.title)}
              title="Double-click to rename"
              className={`rounded px-3 py-1.5 text-sm transition-colors ${
                session.sessionId === activeSessionId
                  ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
                  : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
              }`}
            >
              {tabLabel(session)}
            </button>
          )}
          {editingId !== session.sessionId && (
            <button
              onClick={() => removeSession(session.sessionId)}
              title="Close session"
              className="ml-0.5 rounded px-1.5 py-1 text-xs text-zinc-400 transition-colors hover:text-red-500 dark:text-zinc-500"
            >
              ×
            </button>
          )}
        </div>
      ))}
      <button
        onClick={handleNewSession}
        title="New session"
        className="rounded px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        +
      </button>
      <button
        onClick={() => useReopenSessionStore.getState().setOpen(true)}
        title="Reopen a closed session"
        className="rounded px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        ⌕
      </button>
      <div className="ml-auto flex items-center">
        <AgentPicker />
      </div>
    </div>
  );
}
