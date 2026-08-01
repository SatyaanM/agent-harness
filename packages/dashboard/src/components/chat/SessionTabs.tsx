'use client';

import { useSessionStore } from '@/stores/session-store';
import { createSession } from '@/lib/api';

export default function SessionTabs() {
  const sessions = useSessionStore((s) => s.sessions);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const setActiveSession = useSessionStore((s) => s.setActiveSession);
  const addSession = useSessionStore((s) => s.addSession);

  const handleNewSession = async () => {
    try {
      const session = await createSession();
      addSession({
        sessionId: session.sessionId,
        messages: [],
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    } catch {
      const id = crypto.randomUUID();
      addSession({
        sessionId: id,
        messages: [],
        status: 'active',
        createdAt: new Date().toISOString(),
      });
    }
  };

  return (
    <div className="flex items-center gap-1 border-b border-zinc-200 bg-white px-2 py-1 dark:border-zinc-800 dark:bg-zinc-950">
      {sessions.map((session) => (
        <button
          key={session.sessionId}
          onClick={() => setActiveSession(session.sessionId)}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            session.sessionId === activeSessionId
              ? 'bg-blue-100 text-blue-700 dark:bg-blue-900/50 dark:text-blue-300'
              : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800'
          }`}
        >
          Session {session.sessionId.slice(0, 6)}
        </button>
      ))}
      <button
        onClick={handleNewSession}
        className="rounded px-2 py-1.5 text-sm text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-700 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-200"
      >
        +
      </button>
    </div>
  );
}
