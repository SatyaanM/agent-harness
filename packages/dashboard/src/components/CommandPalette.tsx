"use client";

import type { LucideIcon } from "lucide-react";
import {
  Bot,
  Command as CommandIcon,
  ExternalLink,
  FolderOpen,
  Inbox,
  MessageCircle,
  Moon,
  PanelLeft,
  Plus,
  Puzzle,
  Search,
  Settings as SettingsIcon,
  Star,
  Sun,
  Zap,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import type { SessionMeta } from "@/lib/api";
import { createSession, fetchSession, fetchSessionMeta, openSession } from "@/lib/api";
import { useCommandPaletteStore } from "@/stores/command-palette-store";
import { usePluginStore } from "@/stores/plugin-store";
import { useReopenSessionStore } from "@/stores/reopen-session-store";
import { type Message, useSessionStore } from "@/stores/session-store";
import { useSidebarStore } from "@/stores/sidebar-store";
import { useThemeStore } from "@/stores/theme-store";

interface Command {
  id: string;
  group: string;
  label: string;
  keywords: string;
  icon: LucideIcon;
  run: () => void;
}

const COMMAND_ICONS: Record<string, LucideIcon> = {
  inbox: Inbox,
  bot: Bot,
  puzzle: Puzzle,
  settings: SettingsIcon,
  plus: Plus,
  "message-circle": MessageCircle,
  "folder-open": FolderOpen,
  sun: Sun,
  moon: Moon,
  "panel-left": PanelLeft,
  search: Search,
  command: CommandIcon,
  zap: Zap,
  star: Star,
  "external-link": ExternalLink,
};

function iconFor(name?: string): LucideIcon {
  return (name && COMMAND_ICONS[name]) || CommandIcon;
}

const NAV_ITEMS: { href: string; label: string; icon: LucideIcon }[] = [
  { href: "/", label: "Inbox", icon: Inbox },
  { href: "/agents", label: "Agents", icon: Bot },
  { href: "/plugins", label: "Plugins", icon: Puzzle },
  { href: "/settings", label: "Settings", icon: SettingsIcon },
];

function sessionLabel(session: { title?: string; sessionId: string; messages: Message[] }): string {
  if (session.title?.trim()) return session.title;
  const firstUser = session.messages.find((m) => m.role === "user")?.content?.trim();
  if (firstUser) return firstUser.length > 40 ? `${firstUser.slice(0, 40)}…` : firstUser;
  return `Session ${session.sessionId.slice(0, 6)}`;
}

function metaLabel(meta: SessionMeta): string {
  if (meta.title?.trim()) return meta.title;
  const prompt = meta.prompt?.trim();
  if (prompt) return prompt.length > 40 ? `${prompt.slice(0, 40)}…` : prompt;
  return `Session ${meta.sessionId.slice(0, 6)}`;
}

export default function CommandPalette() {
  const open = useCommandPaletteStore((s) => s.open);
  const setOpen = useCommandPaletteStore((s) => s.setOpen);
  const router = useRouter();
  const sessions = useSessionStore((s) => s.sessions);
  const pluginCommands = usePluginStore((s) => s.commands);

  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(0);
  const [closedMetas, setClosedMetas] = useState<SessionMeta[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Global trigger: Ctrl/Cmd+K.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        useCommandPaletteStore.getState().setOpen(!useCommandPaletteStore.getState().open);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  // Load closed-session metadata each time the palette opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setSelected(0);
    setClosedMetas(null);
    fetchSessionMeta()
      .then((all) => {
        const openIds = new Set(useSessionStore.getState().sessions.map((s) => s.sessionId));
        setClosedMetas(
          all.filter((m) => !openIds.has(m.sessionId) && !m.sessionId.startsWith("worker-")),
        );
      })
      .catch(() => setClosedMetas([]));
  }, [open]);

  const close = useCallback(() => setOpen(false), [setOpen]);

  const commands = useMemo<Command[]>(() => {
    const builtins: Command[] = [];

    for (const item of NAV_ITEMS) {
      builtins.push({
        id: `nav-${item.href}`,
        group: "Go to",
        label: item.label,
        keywords: `${item.label} ${item.href}`,
        icon: item.icon,
        run: () => {
          router.push(item.href);
          close();
        },
      });
    }

    builtins.push({
      id: "session-new",
      group: "Session",
      label: "New session",
      keywords: "new create session",
      icon: Plus,
      run: async () => {
        try {
          const session = await createSession();
          useSessionStore.getState().addSession({
            sessionId: session.sessionId,
            messages: [],
            status: "active",
            agentName: session.agentName ?? "orchestrator",
            title: session.title,
            createdAt: new Date().toISOString(),
          });
          openSession(session.sessionId).catch(() => undefined);
        } catch {
          const id = crypto.randomUUID();
          useSessionStore.getState().addSession({
            sessionId: id,
            messages: [],
            status: "active",
            agentName: "orchestrator",
            createdAt: new Date().toISOString(),
          });
        }
        close();
      },
    });

    for (const session of sessions) {
      builtins.push({
        id: `switch-${session.sessionId}`,
        group: "Session",
        label: `Switch to: ${sessionLabel(session)}`,
        keywords: `switch open ${sessionLabel(session)} ${session.sessionId}`,
        icon: MessageCircle,
        run: () => {
          useSessionStore.getState().setActiveSession(session.sessionId);
          close();
        },
      });
    }

    builtins.push({
      id: "reopen-all",
      group: "Reopen",
      label: "Reopen session…",
      keywords: "reopen closed session choose pick",
      icon: FolderOpen,
      run: () => {
        useReopenSessionStore.getState().setOpen(true);
        close();
      },
    });

    // Quick access to the most recently used closed sessions — never the full
    // list, which would clutter the palette (the modal above is the full list).
    for (const meta of (closedMetas ?? []).slice(0, 5)) {
      builtins.push({
        id: `reopen-${meta.sessionId}`,
        group: "Reopen",
        label: metaLabel(meta),
        keywords: `reopen closed ${metaLabel(meta)} ${meta.agentName ?? ""} ${meta.sessionId}`,
        icon: FolderOpen,
        run: async () => {
          try {
            await openSession(meta.sessionId);
            const session = await fetchSession(meta.sessionId);
            useSessionStore.getState().syncFromServer(session);
            useSessionStore.getState().setActiveSession(meta.sessionId);
          } catch {
            // Non-critical; leave the palette open so the user can try again.
          }
          close();
        },
      });
    }

    builtins.push({
      id: "view-theme",
      group: "View",
      label: "Toggle theme",
      keywords: "theme dark light",
      icon: Sun,
      run: () => {
        useThemeStore.getState().toggle();
        close();
      },
    });

    builtins.push({
      id: "view-sidebar",
      group: "View",
      label: "Toggle sidebar",
      keywords: "sidebar collapse expand",
      icon: PanelLeft,
      run: () => {
        useSidebarStore.getState().toggle();
        close();
      },
    });

    // Plugin commands (declared in plugin manifests) are appended after the
    // built-ins. A `builtin` action resolves against the built-in command ids.
    const builtinById = new Map(builtins.map((c) => [c.id, c]));
    const cmds = [...builtins];

    for (const pluginCommand of pluginCommands) {
      cmds.push({
        id: `plugin-${pluginCommand.id}`,
        group: pluginCommand.group ?? "Plugins",
        label: pluginCommand.label,
        keywords: `${pluginCommand.keywords ?? ""} ${pluginCommand.plugin}`,
        icon: iconFor(pluginCommand.icon),
        run: () => {
          if (pluginCommand.action.type === "navigate") {
            router.push(pluginCommand.action.href);
            close();
          } else {
            builtinById.get(pluginCommand.action.commandId)?.run();
          }
        },
      });
    }

    return cmds;
  }, [sessions, closedMetas, pluginCommands, router, close]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return commands;
    return commands.filter((c) => `${c.label} ${c.keywords}`.toLowerCase().includes(q));
  }, [commands, query]);

  const visibleCount = filtered.length;
  const activeIndex = Math.min(selected, Math.max(visibleCount - 1, 0));

  const runActive = () => {
    const command = filtered[activeIndex];
    if (command) command.run();
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSelected((s) => Math.min(s + 1, visibleCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSelected((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      runActive();
    }
  };

  let lastGroup = "";

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setOpen(false);
      }}
    >
      <DialogContent
        className="top-[20%] max-w-xl translate-y-0 p-0"
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className="sr-only">Command palette</DialogTitle>
        <div className="flex items-center gap-2 border-b border-zinc-200 px-3 dark:border-zinc-800">
          <Search className="h-4 w-4 shrink-0 text-zinc-400" />
          <Input
            ref={inputRef}
            autoFocus
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setSelected(0);
            }}
            onKeyDown={onKeyDown}
            placeholder="Type a command or search…"
            className="h-11 border-0 bg-transparent shadow-none focus-visible:ring-0"
          />
        </div>
        <div className="max-h-80 overflow-y-auto p-1">
          {filtered.length === 0 && (
            <div className="px-3 py-6 text-center text-sm text-zinc-400">No matching commands</div>
          )}
          {filtered.map((command, i) => {
            const Icon = command.icon;
            const showHeader = command.group !== lastGroup;
            lastGroup = command.group;
            return (
              <div key={command.id}>
                {showHeader && (
                  <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-zinc-400 dark:text-zinc-500">
                    {command.group}
                  </div>
                )}
                <button
                  type="button"
                  onClick={command.run}
                  onMouseEnter={() => setSelected(i)}
                  className={`flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left text-sm transition-colors ${
                    i === activeIndex
                      ? "bg-blue-600 text-white"
                      : "text-zinc-700 dark:text-zinc-300"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="truncate">{command.label}</span>
                </button>
              </div>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
