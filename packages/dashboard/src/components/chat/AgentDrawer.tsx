'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { GripVertical, Maximize2, Minimize2, X } from 'lucide-react';
import { useRuntimeStore } from '@/stores/runtime-store';
import { useRosterStore } from '@/stores/agent-roster-store';
import { fetchSession } from '@/lib/api';

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const STORAGE_KEY = 'agent-drawer-width';

interface DrawerAgent {
  id: string;
  name: string;
  role: 'primary' | 'worker';
  status: string;
  taskId?: string;
  task?: string;
}

interface AgentDrawerProps {
  sessionId: string;
  agent: DrawerAgent;
  chatLeft: number;
  visible: boolean;
  onClose: () => void;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === 'running'
      ? 'bg-green-500 animate-pulse'
      : status === 'error'
        ? 'bg-red-500'
        : status === 'done'
          ? 'bg-emerald-500'
          : 'bg-zinc-400';
  return <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${color}`} />;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-3">
      <h3 className="mb-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
        {title}
      </h3>
      <div className="text-sm text-foreground">{children}</div>
    </div>
  );
}

export default function AgentDrawer({
  sessionId,
  agent,
  chatLeft,
  visible,
  onClose,
}: AgentDrawerProps) {
  const [width, setWidth] = useState(() => {
    if (typeof window === 'undefined') return DEFAULT_WIDTH;
    const stored = Number(sessionStorage.getItem(STORAGE_KEY));
    return Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
  });
  const widthRef = useRef(width);
  widthRef.current = width;

  const maxAvailable = Math.max(MIN_WIDTH, Math.floor(chatLeft));
  const clampedWidth = Math.min(width, maxAvailable);

  const activity = useRuntimeStore((s) => s.activity[sessionId] ?? []);
  const myActivity = activity.filter((a) => a.agentName === agent.id).slice(-50);
  const workers = useRosterStore((s) => s.bySession[sessionId] ?? []);

  const [transcript, setTranscript] = useState<any>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  useEffect(() => {
    if (agent.role === 'worker' && agent.id) {
      setTranscriptLoading(true);
      fetchSession(agent.id)
        .then((data) => setTranscript(data))
        .catch(() => setTranscript(null))
        .finally(() => setTranscriptLoading(false));
    } else {
      setTranscript(null);
    }
  }, [agent.id, agent.role]);

  const snapDefault = () => setWidth(DEFAULT_WIDTH);
  const snapMax = () => setWidth(maxAvailable);

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      const onMove = (ev: PointerEvent) => {
        setWidth(Math.min(chatLeft, Math.max(MIN_WIDTH, chatLeft - ev.clientX)));
      };
      const onUp = () => {
        window.removeEventListener('pointermove', onMove);
        window.removeEventListener('pointerup', onUp);
        sessionStorage.setItem(STORAGE_KEY, String(widthRef.current));
      };
      window.addEventListener('pointermove', onMove);
      window.addEventListener('pointerup', onUp);
    },
    [chatLeft]
  );

  return createPortal(
    <div
      className="fixed bottom-0 top-0 z-40 flex flex-col border-r border-border bg-background shadow-2xl transition-transform duration-300 ease-in-out"
      style={{
        width: clampedWidth,
        left: chatLeft - clampedWidth,
        transform: visible ? 'translateX(0)' : `translateX(${clampedWidth}px)`,
      }}
    >
      <div
        className="absolute bottom-0 left-0 top-0 z-10 flex w-2.5 cursor-ew-resize items-center justify-center border-r border-border/60 bg-muted/40 hover:bg-blue-500/20"
        onPointerDown={startResize}
        title="Drag to resize"
      >
        <GripVertical className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="flex items-center gap-2 border-b bg-background py-2 pl-4 pr-2">
        <div className="relative">
          <div
            className={`flex h-9 w-9 items-center justify-center rounded-full text-sm font-semibold text-white ${
              agent.role === 'primary' ? 'bg-blue-600' : 'bg-zinc-600'
            }`}
          >
            {agent.name.charAt(0).toUpperCase()}
          </div>
          <StatusDot status={agent.status} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-foreground">{agent.name}</div>
          <div className="text-xs capitalize text-muted-foreground">
            {agent.role === 'worker' ? 'worker' : 'agent'} · {agent.status}
          </div>
        </div>
        <button
          onClick={snapDefault}
          title="Default width"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Minimize2 className="h-4 w-4" />
        </button>
        <button
          onClick={snapMax}
          title="Max width"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <Maximize2 className="h-4 w-4" />
        </button>
        <button
          onClick={onClose}
          title="Close"
          className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {agent.role === 'worker' && agent.task && (
          <Section title="Task">
            <p className="whitespace-pre-wrap text-xs text-muted-foreground">{agent.task}</p>
          </Section>
        )}

        {agent.role === 'primary' && (
          <Section title="Delegated work">
            {workers.length === 0 ? (
              <p className="text-xs text-muted-foreground">No workers delegated yet.</p>
            ) : (
              <ul className="space-y-1">
                {workers.map((w) => (
                  <li key={w.id} className="flex items-center gap-2 text-xs">
                    <span
                      className={`h-2 w-2 shrink-0 rounded-full ${
                        w.status === 'running'
                          ? 'animate-pulse bg-green-500'
                          : w.status === 'error'
                            ? 'bg-red-500'
                            : 'bg-emerald-500'
                      }`}
                    />
                    <span className="truncate">{w.name}</span>
                    <span className="ml-auto text-muted-foreground">{w.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Section>
        )}

        {agent.role === 'worker' && (
          <Section title="Transcript">
            {transcriptLoading ? (
              <p className="text-xs text-muted-foreground">Loading…</p>
            ) : transcript?.messages?.length ? (
              <div className="space-y-2">
                {transcript.messages.map((m: any, i: number) => (
                  <div key={i} className="text-xs leading-relaxed">
                    <div className="font-medium text-muted-foreground">{m.role}</div>
                    {m.toolCalls?.map((tc: any, j: number) => (
                      <div key={j} className="font-mono text-foreground">
                        ⚙ {tc.toolName}
                        <span className="text-muted-foreground"> {truncate(JSON.stringify(tc.args ?? {}), 120)}</span>
                      </div>
                    ))}
                    {m.content ? <div className="text-foreground">{truncate(m.content, 400)}</div> : null}
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-xs text-muted-foreground">No transcript available.</p>
            )}
          </Section>
        )}

        <Section title="Live activity">
          {myActivity.length === 0 ? (
            <p className="text-xs text-muted-foreground">No tool activity yet.</p>
          ) : (
            <ul className="space-y-1">
              {myActivity.map((a) => (
                <li key={a.id} className="flex items-start gap-1.5 text-xs">
                  <span className={a.type === 'called' ? 'text-blue-500' : 'text-emerald-500'}>
                    {a.type === 'called' ? '→' : '✓'}
                  </span>
                  <span className="font-mono text-foreground">{a.toolName}</span>
                  {a.type === 'completed' && a.result ? (
                    <span className="truncate text-muted-foreground">{truncate(a.result, 80)}</span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </div>
    </div>,
    document.body
  );
}
