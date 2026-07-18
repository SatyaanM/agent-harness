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
    <div className="flex items-center gap-1 border-b border-gray-200 bg-white px-2 py-1">
      {sessions.map((session) => (
        <button
          key={session.sessionId}
          onClick={() => setActiveSession(session.sessionId)}
          className={`rounded px-3 py-1.5 text-sm transition-colors ${
            session.sessionId === activeSessionId
              ? 'bg-blue-100 text-blue-700'
              : 'text-gray-600 hover:bg-gray-100'
          }`}
        >
          Session {session.sessionId.slice(0, 6)}
        </button>
      ))}
      <button
        onClick={handleNewSession}
        className="rounded px-2 py-1.5 text-sm text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
      >
        +
      </button>
    </div>
  );
}
