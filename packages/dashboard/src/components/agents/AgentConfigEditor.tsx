"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { type AgentConfig, deleteAgent, updateAgent } from "@/lib/api";
import { useThemeStore } from "@/stores/theme-store";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

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
  if (config.tools && config.tools.length > 0) {
    lines.push("tools:");
    for (const t of config.tools) {
      lines.push(`  - ${t}`);
    }
  } else {
    lines.push("tools: []");
  }
  if (config.capabilities && config.capabilities.length > 0) {
    lines.push("capabilities:");
    for (const c of config.capabilities) {
      lines.push(`  - ${c}`);
    }
  }
  if (config.modelIdMapping && Object.keys(config.modelIdMapping).length > 0) {
    lines.push("modelIdMapping:");
    for (const [k, v] of Object.entries(config.modelIdMapping)) {
      lines.push(`  ${k}: ${v}`);
    }
  }
  lines.push("---");
  lines.push("");
  if (config.instructions) {
    lines.push(config.instructions);
  }
  return lines.join("\n");
}

function parseMarkdownConfig(content: string): Partial<AgentConfig> {
  const fmMatch = content.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
  if (!fmMatch) return { instructions: content };

  const yamlStr = fmMatch[1];
  const instructions = fmMatch[2];
  const config: Partial<AgentConfig> = { instructions };

  const nameMatch = yamlStr.match(/^name:\s*(.+)$/m);
  if (nameMatch) config.name = nameMatch[1].trim();

  const modelMatch = yamlStr.match(/^model:\s*(.+)$/m);
  if (modelMatch) config.model = modelMatch[1].trim();

  const maxStepsMatch = yamlStr.match(/^maxSteps:\s*(\d+)$/m);
  if (maxStepsMatch) config.maxSteps = Number(maxStepsMatch[1]);

  const toolsMatch = yamlStr.match(/^tools:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (toolsMatch) {
    config.tools = toolsMatch[1].match(/-\s+(.+)/g)?.map((t) => t.replace(/^-\s+/, "")) ?? [];
  }

  const capsMatch = yamlStr.match(/^capabilities:\s*\n((?:\s+-\s+.+\n?)*)/m);
  if (capsMatch) {
    config.capabilities = capsMatch[1].match(/-\s+(.+)/g)?.map((t) => t.replace(/^-\s+/, "")) ?? [];
  }

  return config;
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
    if (initialConfig) {
      setContent(configToMarkdown(initialConfig));
    }
  }, [initialConfig]);

  const handleEditorChange = useCallback((value: string | undefined) => {
    if (value !== undefined) {
      setContent(value);
      setIsDirty(true);
      setSuccess(false);
    }
  }, []);

  async function handleSave() {
    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const parsed = parseMarkdownConfig(content);
      const updated = await updateAgent(agentName, parsed);
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
