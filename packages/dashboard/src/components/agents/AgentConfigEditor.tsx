"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type AgentConfig, deleteAgent, fetchAgentSource, updateAgentSource } from "@/lib/api";
import { useThemeStore } from "@/stores/theme-store";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });
const DRAFT_KEY_PREFIX = "agent-source-draft:";

function loadDraft(agentName: string): string | null {
  try {
    return sessionStorage.getItem(`${DRAFT_KEY_PREFIX}${agentName}`);
  } catch {
    return null;
  }
}

function saveDraft(agentName: string, content: string | null) {
  try {
    const key = `${DRAFT_KEY_PREFIX}${agentName}`;
    if (content === null) sessionStorage.removeItem(key);
    else sessionStorage.setItem(key, content);
  } catch {
    // Navigation protection still guards the current editor when storage is unavailable.
  }
}

interface AgentConfigEditorProps {
  agentName: string;
  initialConfig?: AgentConfig;
  onDeleted?: () => void;
  onSaved?: (config: AgentConfig) => void;
}

function configToMarkdown(config: AgentConfig): string {
  const lines: string[] = ["---"];
  lines.push(`name: ${config.name}`);
  lines.push(`model: ${config.model}`);
  lines.push(`maxSteps: ${config.maxSteps}`);
  if (config.description !== undefined) lines.push(`description: ${config.description}`);
  for (const key of [
    "maxToolCalls",
    "maxToolResultChars",
    "maxOutputTokens",
    "maxTotalTokens",
    "runTimeoutMs",
  ] as const) {
    if (config[key] !== undefined) lines.push(`${key}: ${config[key]}`);
  }
  if (config.tools && config.tools.length > 0) {
    lines.push("tools:");
    for (const t of config.tools) {
      lines.push(`  - ${t}`);
    }
  } else {
    lines.push("tools: []");
  }
  if (config.capabilities) {
    lines.push("capabilities:");
    lines.push(`  chat: ${config.capabilities.chat}`);
    lines.push(`  tools: ${config.capabilities.tools}`);
    lines.push(`  vision: ${config.capabilities.vision}`);
    lines.push(`  streaming: ${config.capabilities.streaming}`);
    lines.push(`  maxTokens: ${config.capabilities.maxTokens}`);
  }
  if (config.modelIdMapping) {
    lines.push(`modelIdMapping: ${config.modelIdMapping}`);
  }
  lines.push("---");
  lines.push("");
  if (config.instructions) {
    lines.push(config.instructions);
  }
  return lines.join("\n");
}

export function AgentConfigEditor({
  agentName,
  initialConfig,
  onDeleted,
  onSaved,
}: AgentConfigEditorProps) {
  const [content, setContent] = useState("");
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const theme = useThemeStore((s) => s.theme);

  useEffect(() => {
    let cancelled = false;
    const draft = loadDraft(agentName);
    if (draft !== null) {
      setContent(draft);
      setIsDirty(true);
    } else if (initialConfig) {
      setContent(configToMarkdown(initialConfig));
    }
    fetchAgentSource(agentName)
      .then((source) => {
        if (cancelled) return;
        if (draft !== null) {
          setContent(draft);
          setIsDirty(true);
        } else {
          setContent(source);
          setIsDirty(false);
        }
      })
      .catch(() => {
        if (!cancelled) setError("Failed to load agent source");
      });
    return () => {
      cancelled = true;
    };
  }, [agentName, initialConfig]);

  useEffect(() => {
    if (!isDirty) return;

    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    const guardInternalNavigation = (event: MouseEvent) => {
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }
      const target = event.target instanceof Element ? event.target.closest("a[href]") : null;
      if (!(target instanceof HTMLAnchorElement) || target.target === "_blank") return;
      const destination = new URL(target.href, window.location.href);
      if (destination.origin !== window.location.origin) return;
      if (window.confirm("Discard unsaved agent changes?")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    };

    window.addEventListener("beforeunload", warnBeforeUnload);
    document.addEventListener("click", guardInternalNavigation, true);
    return () => {
      window.removeEventListener("beforeunload", warnBeforeUnload);
      document.removeEventListener("click", guardInternalNavigation, true);
    };
  }, [isDirty]);

  const handleEditorChange = useCallback(
    (value: string | undefined) => {
      if (value !== undefined) {
        setContent(value);
        setIsDirty(true);
        setSuccess(false);
        saveDraft(agentName, value);
      }
    },
    [agentName],
  );

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const updated = await updateAgentSource(agentName, content);
      saveDraft(agentName, null);
      setIsDirty(false);
      setSuccess(true);
      onSaved?.(updated);
    } catch {
      setError("Failed to save agent");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete() {
    if (!confirm(`Delete agent "${agentName}"? This cannot be undone.`)) return;
    setDeleting(true);
    setError(null);
    try {
      await deleteAgent(agentName);
      saveDraft(agentName, null);
      onDeleted?.();
    } catch {
      setError("Failed to delete agent");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-2 border-b">
        <div className="flex items-center gap-3">
          <h3 className="text-sm font-semibold text-foreground">{agentName}</h3>
          {isDirty && (
            <span className="text-xs text-amber-600 dark:text-amber-400">Unsaved changes</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={handleDelete}
            disabled={deleting}
            variant="outline"
            size="sm"
            className="border-destructive/50 text-destructive hover:bg-destructive/10"
          >
            {deleting ? "Deleting..." : "Delete"}
          </Button>
          <Button onClick={handleSave} disabled={saving || !isDirty} size="sm">
            {saving ? "Saving..." : "Save"}
          </Button>
        </div>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {success && (
        <div className="mx-4 mt-2 rounded border border-green-500/30 bg-green-500/10 px-3 py-2 text-sm text-green-600 dark:text-green-400">
          Agent saved successfully
        </div>
      )}

      <div className="flex-1 min-h-0">
        <MonacoEditor
          height="100%"
          language="markdown"
          theme={theme === "dark" ? "vs-dark" : "light"}
          value={content}
          onChange={handleEditorChange}
          options={{
            minimap: { enabled: false },
            fontSize: 13,
            lineNumbers: "on",
            scrollBeyondLastLine: false,
            wordWrap: "on",
            automaticLayout: true,
            tabSize: 2,
          }}
        />
      </div>
    </div>
  );
}
