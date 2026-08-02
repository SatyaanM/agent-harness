'use client';

import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { useSessionStore } from '@/stores/session-store';
import { useRosterStore } from '@/stores/agent-roster-store';
import { useRuntimeStore } from '@/stores/runtime-store';
import AgentDrawer from './AgentDrawer';

interface BubbleEntry {
  id: string;
  name: string;
  role: 'primary' | 'worker';
  status: string;
  taskId?: string;
  task?: string;
}

export default function AgentColumn() {
  const ref = useRef<HTMLDivElement>(null);
  const [chatLeft, setChatLeft] = useState(0);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const workers = useRosterStore(
    useShallow((s) => (activeSessionId ? s.bySession[activeSessionId] ?? [] : []))
  );
  const running = useRuntimeStore((s) =>
    activeSessionId ? !!s.running[activeSessionId] : false
  );
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [closing, setClosing] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const parent = el.parentElement;
    const update = () => setChatLeft(el.getBoundingClientRect().left);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    if (parent) ro.observe(parent);
    window.addEventListener('resize', update);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', update);
    };
  }, [activeSessionId]);

  const openDrawer = (id: string) => {
    if (ref.current) setChatLeft(ref.current.getBoundingClientRect().left);
    setClosing(false);
    setSelectedId(id);
  };

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const primaryName = activeSession?.agentName ?? 'orchestrator';

  if (!activeSessionId) return null;

  const entries: BubbleEntry[] = [
    { id: primaryName, name: primaryName, role: 'primary', status: running ? 'running' : 'idle' },
    ...workers.map((w) => ({
      id: w.id,
      name: w.name,
      role: 'worker' as const,
      status: w.status,
      taskId: w.taskId,
      task: w.task,
    })),
  ];

  const selectedEntry = entries.find((e) => e.id === selectedId) ?? null;

  const closeDrawer = () => {
    setClosing(true);
    setTimeout(() => {
      setSelectedId(null);
      setClosing(false);
    }, 300);
  };

  return (
    <div
      ref={ref}
      className="flex h-full w-12 shrink-0 flex-col items-center gap-2 overflow-y-auto border-r border-border bg-background py-2"
    >
      {entries.map((entry, i) => (
        <button
          key={entry.id}
          onClick={() => openDrawer(entry.id)}
          title={`${entry.name} (${entry.status})`}
          className={`relative flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white transition-transform hover:scale-110 ${
            entry.role === 'primary' ? 'bg-blue-600' : 'bg-zinc-600'
          } ${selectedEntry?.id === entry.id ? 'ring-2 ring-blue-400' : ''}`}
          style={{
            animation: 'bubble-pop 0.25s ease-out both',
            animationDelay: `${i * 60}ms`,
          }}
        >
          {entry.name.charAt(0).toUpperCase()}
          <span
            className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border border-background ${
              entry.status === 'running'
                ? 'animate-pulse bg-green-500'
                : entry.status === 'error'
                  ? 'bg-red-500'
                  : entry.status === 'done'
                    ? 'bg-emerald-500'
                    : 'bg-zinc-400'
            }`}
          />
        </button>
      ))}

      {selectedEntry && (
        <AgentDrawer
          sessionId={activeSessionId}
          agent={selectedEntry}
          chatLeft={chatLeft}
          visible={!closing}
          onClose={closeDrawer}
        />
      )}
    </div>
  );
}
