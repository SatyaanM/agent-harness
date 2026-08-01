'use client';

import { useEffect, useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Folder,
  FolderOpen,
  FolderPlus,
  File,
  FileText,
  FileCode,
  FileImage,
  FileSpreadsheet,
  FileArchive,
  RefreshCw,
  Copy,
  MessageSquare,
  Trash2,
  ExternalLink,
} from 'lucide-react';
import {
  fetchInboxTree,
  moveInboxItem,
  deleteInboxItem,
  createInboxDir,
  openInboxItem,
  type InboxTreeEntry,
} from '@/lib/api';
import { useInboxWorkspaceStore } from '@/stores/inbox-workspace-store';
import { useChatInputStore } from '@/stores/chat-input-store';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';

function fileIcon(name: string) {
  const ext = name.split('.').pop()?.toLowerCase() ?? '';
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg'].includes(ext)) return FileImage;
  if (['csv', 'tsv', 'xlsx'].includes(ext)) return FileSpreadsheet;
  if (['zip', 'tar', 'gz', 'rar', '7z'].includes(ext)) return FileArchive;
  if (['ts', 'tsx', 'js', 'jsx', 'py', 'rs', 'go', 'java', 'c', 'cpp'].includes(ext))
    return FileCode;
  if (['md', 'markdown', 'txt', 'log'].includes(ext)) return FileText;
  return File;
}

function dirnameOf(p: string): string {
  const i = p.lastIndexOf('/');
  return i === -1 ? '' : p.slice(0, i);
}

interface MenuHandlers {
  onCopy: (path: string) => void;
  onAddToChat: (path: string) => void;
  onCreateFolder: (parent: string) => void;
  onDelete: (entry: InboxTreeEntry) => void;
  onOpenExplorer: (entry: InboxTreeEntry) => void;
}

interface MoveHandlers {
  dragPath: string | null;
  onDragStart: (path: string) => void;
  onDragEnd: () => void;
  onMove: (from: string, toDir: string) => void;
}

function RowMenu({
  entry,
  menu,
  children,
}: {
  entry: InboxTreeEntry;
  menu: MenuHandlers;
  children: React.ReactNode;
}) {
  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>{children}</ContextMenuTrigger>
      <ContextMenuContent className="w-56">
        <ContextMenuItem
          className="gap-2"
          onClick={() => menu.onCopy(entry.absPath)}
        >
          <Copy className="h-4 w-4" />
          Copy path
        </ContextMenuItem>
        <ContextMenuItem
          className="gap-2"
          onClick={() => menu.onAddToChat(entry.absPath)}
        >
          <MessageSquare className="h-4 w-4" />
          Add path to chat
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2"
          onClick={() =>
            menu.onCreateFolder(
              entry.type === 'dir' ? entry.path : dirnameOf(entry.path)
            )
          }
        >
          <FolderPlus className="h-4 w-4" />
          Create folder
        </ContextMenuItem>
        <ContextMenuItem
          className="gap-2 text-destructive focus:text-destructive"
          onClick={() => menu.onDelete(entry)}
        >
          <Trash2 className="h-4 w-4" />
          Delete
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem
          className="gap-2"
          onClick={() => menu.onOpenExplorer(entry)}
        >
          <ExternalLink className="h-4 w-4" />
          Open in explorer
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
}

function FileRow({
  entry,
  selectedPath,
  depth,
  hoveredDropPath,
  onDropHover,
  onDropLeave,
  move,
  menu,
}: {
  entry: InboxTreeEntry;
  selectedPath: string | null;
  depth: number;
  hoveredDropPath: string | null;
  onDropHover: (path: string | null) => void;
  onDropLeave: () => void;
  move: MoveHandlers;
  menu: MenuHandlers;
}) {
  if (entry.type === 'dir') {
    return (
      <DirRow
        entry={entry}
        selectedPath={selectedPath}
        depth={depth}
        hoveredDropPath={hoveredDropPath}
        onDropHover={onDropHover}
        onDropLeave={onDropLeave}
        move={move}
        menu={menu}
      />
    );
  }
  const Icon = fileIcon(entry.name);
  const isActive = entry.path === selectedPath;
  const select = useInboxWorkspaceStore((s) => s.setSelectedPath);

  return (
    <RowMenu entry={entry} menu={menu}>
      <button
        draggable
        onClick={() => select(entry.path)}
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', entry.path);
          e.dataTransfer.effectAllowed = 'move';
          move.onDragStart(entry.path);
        }}
        onDragEnd={move.onDragEnd}
        className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm transition-colors ${
          isActive
            ? 'bg-accent text-accent-foreground'
            : 'text-muted-foreground hover:bg-accent/60 hover:text-accent-foreground'
        } ${move.dragPath === entry.path ? 'opacity-40' : ''}`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        <Icon className="h-4 w-4 shrink-0" />
        <span className="truncate">{entry.name}</span>
      </button>
    </RowMenu>
  );
}

function DirRow({
  entry,
  selectedPath,
  depth,
  hoveredDropPath,
  onDropHover,
  onDropLeave,
  move,
  menu,
}: {
  entry: InboxTreeEntry;
  selectedPath: string | null;
  depth: number;
  hoveredDropPath: string | null;
  onDropHover: (path: string | null) => void;
  onDropLeave: () => void;
  move: MoveHandlers;
  menu: MenuHandlers;
}) {
  const [open, setOpen] = useState(false);
  const isDropTarget = hoveredDropPath === entry.path;

  return (
    <div>
      <RowMenu entry={entry} menu={menu}>
        <button
          draggable
          onClick={() => setOpen((o) => !o)}
          onDragStart={(e) => {
            e.dataTransfer.setData('text/plain', entry.path);
            e.dataTransfer.effectAllowed = 'move';
            move.onDragStart(entry.path);
          }}
          onDragEnd={move.onDragEnd}
          onDragOver={(e) => {
            if (!move.dragPath || move.dragPath === entry.path) return;
            e.preventDefault();
            e.dataTransfer.dropEffect = 'move';
            onDropHover(entry.path);
          }}
          onDragLeave={onDropLeave}
          onDrop={(e) => {
            e.preventDefault();
            onDropLeave();
            const from = e.dataTransfer.getData('text/plain');
            if (from && from !== entry.path) move.onMove(from, entry.path);
          }}
          className={`flex w-full items-center gap-1.5 rounded-md px-2 py-1.5 text-sm transition-colors ${
            isDropTarget
              ? 'bg-blue-100 text-blue-900 ring-1 ring-blue-400 dark:bg-blue-950/50 dark:text-blue-200'
              : 'hover:bg-accent/60 hover:text-accent-foreground'
          } ${move.dragPath === entry.path ? 'opacity-40' : ''}`}
          style={{ paddingLeft: `${depth * 16 + 4}px` }}
        >
          {open ? (
            <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
          )}
          {open ? (
            <FolderOpen className="h-4 w-4 shrink-0 text-amber-500" />
          ) : (
            <Folder className="h-4 w-4 shrink-0 text-amber-500" />
          )}
          <span className="truncate font-medium text-foreground">{entry.name}</span>
        </button>
      </RowMenu>
      {open && (
        <div>
          {(entry.children ?? []).map((child) => (
            <FileRow
              key={child.path}
              entry={child}
              selectedPath={selectedPath}
              depth={depth + 1}
              hoveredDropPath={hoveredDropPath}
              onDropHover={onDropHover}
              onDropLeave={onDropLeave}
              move={move}
              menu={menu}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function FileExplorer({
  collapsed,
  onToggleCollapse,
}: {
  collapsed: boolean;
  onToggleCollapse: () => void;
}) {
  const [tree, setTree] = useState<InboxTreeEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [dragPath, setDragPath] = useState<string | null>(null);
  const [hoveredDropPath, setHoveredDropPath] = useState<string | null>(null);
  const [isRootDropTarget, setIsRootDropTarget] = useState(false);
  const selectedPath = useInboxWorkspaceStore((s) => s.selectedPath);
  const setSelectedPath = useInboxWorkspaceStore((s) => s.setSelectedPath);
  const prefillChat = useChatInputStore((s) => s.prefill);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      setTree(await fetchInboxTree());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load inbox');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const move = async (from: string, toDir: string) => {
    if (!from || from === toDir) return;
    try {
      await moveInboxItem(from, toDir);
      await load();
      if (selectedPath) {
        const base = from.split('/').pop() ?? from;
        const prefix = toDir ? `${toDir}/${base}` : base;
        if (selectedPath === from) {
          setSelectedPath(prefix);
        } else if (selectedPath.startsWith(`${from}/`)) {
          setSelectedPath(prefix + selectedPath.slice(from.length));
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to move item');
    } finally {
      setDragPath(null);
      setHoveredDropPath(null);
      setIsRootDropTarget(false);
    }
  };

  const clearDrag = () => {
    setDragPath(null);
    setHoveredDropPath(null);
    setIsRootDropTarget(false);
  };

  const menu: MenuHandlers = {
    onCopy: async (path) => {
      try {
        await navigator.clipboard.writeText(path);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to copy path');
      }
    },
    onAddToChat: (path) => prefillChat(path),    onCreateFolder: async (parent) => {
      const name = window.prompt('Folder name');
      if (!name?.trim()) return;
      const target = parent ? `${parent}/${name.trim()}` : name.trim();
      try {
        await createInboxDir(target);
        await load();
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to create folder');
      }
    },
    onDelete: async (entry) => {
      const label = entry.type === 'dir' ? `folder "${entry.name}" and its contents` : `"${entry.name}"`;
      if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;
      try {
        await deleteInboxItem(entry.path);
        await load();
        if (selectedPath === entry.path || selectedPath?.startsWith(`${entry.path}/`)) {
          setSelectedPath(null);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to delete item');
      }
    },
    onOpenExplorer: async (entry) => {
      try {
        await openInboxItem(entry.path);
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to open in explorer');
      }
    },
  };

  if (collapsed) {
    return (
      <div className="flex h-full flex-col items-center bg-background py-2">
        <Button
          variant="ghost"
          size="icon"
          onClick={onToggleCollapse}
          title="Expand inbox sidebar"
          aria-label="Expand inbox sidebar"
          className="h-7 w-7"
        >
          <ChevronsRight className="h-3.5 w-3.5" />
        </Button>
      </div>
    );
  }

  const handleRootDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsRootDropTarget(false);
    const from = e.dataTransfer.getData('text/plain');
    if (from) move(from, '');
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-background px-3 py-2">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Inbox
        </h2>
        <div className="flex items-center gap-0.5">
          <Button
            variant="ghost"
            size="icon"
            onClick={load}
            title="Refresh"
            aria-label="Refresh inbox"
            className="h-7 w-7"
          >
            <RefreshCw className="h-3.5 w-3.5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            onClick={onToggleCollapse}
            title="Collapse sidebar"
            aria-label="Collapse sidebar"
            className="h-7 w-7"
          >
            <ChevronsLeft className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {error && (
        <div className="m-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      <div
        onDragOver={(e) => {
          if (!dragPath) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = 'move';
          setIsRootDropTarget(true);
        }}
        onDragLeave={(e) => {
          if (e.currentTarget.contains(e.relatedTarget as Node)) return;
          setIsRootDropTarget(false);
        }}
        onDrop={handleRootDrop}
        className={`flex-1 overflow-y-auto p-1.5 ${
          isRootDropTarget ? 'bg-blue-50 dark:bg-blue-950/30' : ''
        }`}
      >
        {loading && tree.length === 0 ? (
          <div className="space-y-1">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="h-7 w-full" />
            ))}
          </div>
        ) : tree.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-muted-foreground">
            Inbox is empty
          </div>
        ) : (
          tree.map((entry) => (
            <FileRow
              key={entry.path}
              entry={entry}
              selectedPath={selectedPath}
              depth={0}
              hoveredDropPath={hoveredDropPath}
              onDropHover={setHoveredDropPath}
              onDropLeave={() => setHoveredDropPath(null)}
              move={{ dragPath, onDragStart: setDragPath, onDragEnd: clearDrag, onMove: move }}
              menu={menu}
            />
          ))
        )}
      </div>
    </div>
  );
}
