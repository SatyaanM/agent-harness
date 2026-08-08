'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { fetchSessionMeta, fetchSession, openSession } from '@/lib/api';
import type { SessionMeta } from '@/lib/api';
import { useSessionStore } from '@/stores/session-store';
import { useReopenSessionStore } from '@/stores/reopen-session-store';

function displayLabel(meta: SessionMeta): string {
  if (meta.title?.trim()) return meta.title;
  const prompt = meta.prompt?.trim();
  if (prompt) return prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;
  return `Session ${meta.sessionId.slice(0, 6)}`;
}

export default function ReopenSessionModal() {
  const open = useReopenSessionStore((s) => s.open);
  const setOpen = useReopenSessionStore((s) => s.setOpen);
  const [metas, setMetas] = useState<SessionMeta[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setMetas(null);
    setError(false);
    setQuery('');
    fetchSessionMeta()
      .then((all) => {
        if (cancelled) return;
        const openIds = new Set(
          useSessionStore.getState().sessions.map((s) => s.sessionId)
        );
        setMetas(
          all.filter(
            (m) => !openIds.has(m.sessionId) && !m.sessionId.startsWith('worker-')
          )
        );
      })
      .catch(() => {
        if (!cancelled) setError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const filtered = useMemo(() => {
    if (!metas) return [];
    const q = query.trim().toLowerCase();
    if (!q) return metas;
    return metas.filter((m) =>
      [m.title, m.prompt, m.agentName, m.sessionId].some((v) =>
        v?.toLowerCase().includes(q)
      )
    );
  }, [metas, query]);

  const handleSelect = async (meta: SessionMeta) => {
    try {
      await openSession(meta.sessionId);
      const session = await fetchSession(meta.sessionId);
      useSessionStore.getState().syncFromServer(session);
      useSessionStore.getState().setActiveSession(meta.sessionId);
      setOpen(false);
    } catch {
      setError(true);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setOpen(false);
      }}
    >
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Reopen session</DialogTitle>
          <DialogDescription>
            Pick a session to reopen as a tab. Sessions are never deleted when
            closed — they are recoverable here.
          </DialogDescription>
        </DialogHeader>
        <Input
          placeholder="Search sessions…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <div className="max-h-80 overflow-y-auto">
          {error && <div className="text-sm text-red-400">Failed to load sessions</div>}
          {!error && metas === null && (
            <div className="py-8 text-center text-sm text-zinc-400">Loading sessions…</div>
          )}
          {!error && metas !== null && filtered.length === 0 && (
            <div className="py-8 text-center text-sm text-zinc-400">
              {query ? 'No matching sessions' : 'No closed sessions'}
            </div>
          )}
          {filtered.map((meta) => (
            <button
              key={meta.sessionId}
              onClick={() => handleSelect(meta)}
              className="flex w-full items-center justify-between gap-3 rounded-md px-3 py-2 text-left transition-colors hover:bg-zinc-100 dark:hover:bg-zinc-800"
            >
              <div className="min-w-0">
                <div className="truncate text-sm font-medium">{displayLabel(meta)}</div>
                <div className="truncate text-xs text-zinc-500 dark:text-zinc-400">
                  {meta.agentName ?? 'orchestrator'} ·{' '}
                  {new Date(meta.updatedAt).toLocaleString()}
                </div>
              </div>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
