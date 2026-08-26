"use client";

import type { Message, SessionData } from "@agent-harness/core/contracts";
import { createLogger, describeError } from "@agent-harness/core/contracts";
import { GripVertical, Maximize2, Minimize2, Square, X } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useShallow } from "zustand/react/shallow";
import { cancelWorker, fetchSession } from "@/lib/api";
import { useRosterStore } from "@/stores/agent-roster-store";
import { useRuntimeStore } from "@/stores/runtime-store";

const logger = createLogger("dashboard.agent-drawer");

const DEFAULT_WIDTH = 360;
const MIN_WIDTH = 280;
const STORAGE_KEY = "agent-drawer-width";

interface DrawerAgent {
  id: string;
  name: string;
  role: "primary" | "worker";
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

export function shouldPollWorker(role: DrawerAgent["role"], status: string): boolean {
  return role === "worker" && status === "running";
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function StatusDot({ status }: { status: string }) {
  const color =
    status === "running"
      ? "bg-green-500 animate-pulse"
      : status === "failed" || status === "abandoned"
        ? "bg-red-500"
        : status === "cancelled" || status === "paused"
          ? "bg-amber-500"
          : status === "completed"
            ? "bg-emerald-500"
            : "bg-zinc-400";
  return (
    <span
      className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-background ${color}`}
    />
  );
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

function Disclosure({
  label,
  preview,
  children,
  initial = false,
}: {
  label: string;
  preview: string;
  children: React.ReactNode;
  initial?: boolean;
}) {
  const [open, setOpen] = useState(initial);
  return (
    <div className="my-1 overflow-hidden rounded border border-border bg-muted/30">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full min-w-0 items-center gap-1.5 px-2 py-1 text-left font-mono text-[11px] text-foreground transition-colors hover:bg-muted/50"
      >
        <span className="text-muted-foreground">{open ? "▾" : "▸"}</span>
        <span className="shrink-0">{label}</span>
        <span className="min-w-0 truncate text-muted-foreground">{preview}</span>
      </button>
      {open && (
        <div className="border-t border-border px-2 py-1.5">
          <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-relaxed text-foreground">
            {children}
          </pre>
        </div>
      )}
    </div>
  );
}

function TranscriptMessage({ m }: { m: Message }) {
  const roleLabel =
    m.role === "tool"
      ? "✓ result"
      : m.role === "assistant"
        ? "assistant"
        : m.role === "user"
          ? "user"
          : m.role;
  return (
    <div className="space-y-1">
      <div className="font-medium text-muted-foreground">{roleLabel}</div>
      {m.reasoning ? (
        <Disclosure label="reasoning" preview={truncate(m.reasoning, 60)}>
          {m.reasoning}
        </Disclosure>
      ) : null}
      {m.toolCalls?.map((tc, index) => (
        <Disclosure
          // biome-ignore lint/suspicious/noArrayIndexKey: Persisted transcript tool-call order is immutable and legacy calls may not have IDs.
          key={index}
          label={`⚙ ${tc.toolName}`}
          preview={truncate(JSON.stringify(tc.args ?? {}), 80)}
        >
          {JSON.stringify(tc.args ?? {}, null, 2)}
        </Disclosure>
      ))}
      {m.content ? (
        <Disclosure
          label={m.role === "tool" ? "result" : "content"}
          preview={truncate(m.content, 80)}
        >
          {m.content}
        </Disclosure>
      ) : null}
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
  const targetRef = useRef<number>(DEFAULT_WIDTH);
  if (targetRef.current === DEFAULT_WIDTH && typeof window !== "undefined") {
    const stored = Number(sessionStorage.getItem(STORAGE_KEY));
    targetRef.current = Number.isFinite(stored) && stored >= MIN_WIDTH ? stored : DEFAULT_WIDTH;
  }
  const [width, setWidth] = useState(0);
  const [dragging, setDragging] = useState(false);

  const maxAvailable = Math.max(MIN_WIDTH, Math.floor(chatLeft));
  const contentWidth = Math.min(targetRef.current, maxAvailable);

  const activity = useRuntimeStore(useShallow((s) => s.activity[sessionId] ?? []));
  const myActivity = activity.filter((a) => a.agentName === agent.id).slice(-50);
  const workers = useRosterStore(useShallow((s) => s.bySession[sessionId] ?? []));

  const [transcript, setTranscript] = useState<SessionData | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);

  // Open: slide out from under the chat (width 0 → target).
  // biome-ignore lint/correctness/useExhaustiveDependencies: The opening animation runs once; resize and drag handlers own later width changes.
  useEffect(() => {
    const id = requestAnimationFrame(() => setWidth(contentWidth));
    return () => cancelAnimationFrame(id);
  }, []);

  // Close: retract back under the chat (width → 0).
  useEffect(() => {
    if (!visible) setWidth(0);
  }, [visible]);

  // Worker transcript: poll while running so progressive saves show up live.
  useEffect(() => {
    if (agent.role !== "worker" || !agent.id) {
      setTranscript(null);
      setTranscriptLoading(false);
      return;
    }
    const controller = new AbortController();
    let requestInFlight = false;
    const load = () => {
      if (requestInFlight) return;
      requestInFlight = true;
      void fetchSession(agent.id, { signal: controller.signal })
        .then((data) => {
          if (controller.signal.aborted) return;
          setTranscript(data);
        })
        .catch((error: unknown) => {
          if (!controller.signal.aborted) {
            logger.error("Failed to load worker transcript", { ...describeError(error) });
          }
        })
        .finally(() => {
          requestInFlight = false;
          if (!controller.signal.aborted) setTranscriptLoading(false);
        });
    };
    setTranscriptLoading(true);
    load();
    const id = shouldPollWorker(agent.role, agent.status) ? setInterval(load, 2000) : undefined;
    return () => {
      controller.abort();
      if (id !== undefined) clearInterval(id);
    };
  }, [agent.id, agent.role, agent.status]);

  const snap = (w: number) => {
    targetRef.current = w;
    setWidth(w);
  };
  const snapDefault = () => snap(DEFAULT_WIDTH);
  const snapMax = () => snap(maxAvailable);

  const [cancelling, setCancelling] = useState(false);
  const handleCancel = async () => {
    if (!agent.taskId) return;
    setCancelling(true);
    try {
      await cancelWorker(agent.taskId);
    } catch {
      setCancelling(false);
    }
  };

  const startResize = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      setDragging(true);
      const onMove = (ev: PointerEvent) => {
        const next = Math.min(maxAvailable, Math.max(MIN_WIDTH, chatLeft - ev.clientX));
        targetRef.current = next;
        setWidth(next);
      };
      const onUp = () => {
        setDragging(false);
        sessionStorage.setItem(STORAGE_KEY, String(targetRef.current));
        window.removeEventListener("pointermove", onMove);
        window.removeEventListener("pointerup", onUp);
      };
      window.addEventListener("pointermove", onMove);
      window.addEventListener("pointerup", onUp);
    },
    [chatLeft, maxAvailable],
  );

  return createPortal(
    <div
      className="fixed bottom-0 top-0 z-40"
      style={{
        right: `calc(100vw - ${chatLeft}px)`,
        width: Math.min(width, maxAvailable),
        overflow: "hidden",
        transition: dragging ? "none" : "width 250ms ease",
        pointerEvents: visible ? "auto" : "none",
      }}
    >
      <div
        className="relative flex h-full flex-col border-r border-border bg-background shadow-2xl"
        style={{ width: contentWidth }}
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
                agent.role === "primary" ? "bg-blue-600" : "bg-zinc-600"
              }`}
            >
              {agent.name.charAt(0).toUpperCase()}
            </div>
            <StatusDot status={agent.status} />
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-foreground">{agent.name}</div>
            <div className="text-xs capitalize text-muted-foreground">
              {agent.role === "worker" ? "worker" : "agent"} · {agent.status}
            </div>
          </div>
          <button
            type="button"
            onClick={snapDefault}
            title="Default width"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Minimize2 className="h-4 w-4" />
          </button>
          <button
            type="button"
            onClick={snapMax}
            title="Max width"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <Maximize2 className="h-4 w-4" />
          </button>
          {agent.role === "worker" && agent.status === "running" && (
            <button
              type="button"
              onClick={handleCancel}
              disabled={cancelling}
              title="Stop worker"
              className="rounded p-1.5 text-red-500 transition-colors hover:bg-red-500/10"
            >
              <Square className={cancelling ? "animate-pulse h-4 w-4" : "h-4 w-4"} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            title="Close"
            className="rounded p-1.5 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-4">
          {agent.role === "worker" && agent.task && (
            <Section title="Task">
              <p className="whitespace-pre-wrap text-xs text-muted-foreground">{agent.task}</p>
            </Section>
          )}

          {agent.role === "primary" && (
            <Section title="Delegated work">
              {workers.length === 0 ? (
                <p className="text-xs text-muted-foreground">No workers delegated yet.</p>
              ) : (
                <ul className="space-y-1">
                  {workers.map((w) => (
                    <li key={w.id} className="flex items-center gap-2 text-xs">
                      <span
                        className={`h-2 w-2 shrink-0 rounded-full ${
                          w.status === "running"
                            ? "animate-pulse bg-green-500"
                            : w.status === "failed" || w.status === "abandoned"
                              ? "bg-red-500"
                              : w.status === "cancelled" || w.status === "paused"
                                ? "bg-amber-500"
                                : "bg-emerald-500"
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

          {agent.role === "worker" && (
            <Section title="Transcript">
              {transcriptLoading ? (
                <p className="text-xs text-muted-foreground">Loading…</p>
              ) : transcript?.messages?.length ? (
                <div className="space-y-2">
                  {transcript.messages.map((m, index) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: Persisted transcript order is immutable and legacy messages may not have IDs.
                    <TranscriptMessage key={index} m={m} />
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
                    <span className={a.type === "called" ? "text-blue-500" : "text-emerald-500"}>
                      {a.type === "called" ? "→" : "✓"}
                    </span>
                    <span className="font-mono text-foreground">{a.toolName}</span>
                    {a.type === "completed" && a.result ? (
                      <span className="truncate text-muted-foreground">
                        {truncate(a.result, 80)}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </Section>
        </div>
      </div>
    </div>,
    document.body,
  );
}
