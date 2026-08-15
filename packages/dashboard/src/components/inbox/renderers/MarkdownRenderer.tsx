"use client";

import { FilePenLine, Save, X } from "lucide-react";
import dynamic from "next/dynamic";
import { useCallback, useEffect, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { createHighlighter, type Highlighter } from "shiki";
import { Button } from "@/components/ui/button";
import { updateInboxFile } from "@/lib/api";
import { useThemeStore } from "@/stores/theme-store";
import { useInboxHeaderActions } from "../header-actions";

const MonacoEditor = dynamic(() => import("@monaco-editor/react"), { ssr: false });

const HIGHLIGHT_LANGS = [
  "typescript",
  "javascript",
  "jsx",
  "tsx",
  "json",
  "jsonc",
  "yaml",
  "markdown",
  "python",
  "rust",
  "go",
  "bash",
  "shell",
  "sql",
  "css",
  "scss",
  "html",
  "xml",
  "java",
  "c",
  "cpp",
  "csharp",
  "ruby",
  "php",
  "diff",
  "toml",
  "graphql",
  "powershell",
];

let highlighterPromise: Promise<Highlighter> | null = null;

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: ["github-dark", "github-light"],
      langs: HIGHLIGHT_LANGS,
    });
  }
  return highlighterPromise;
}

function CodeBlock({
  code,
  lang,
  theme,
}: {
  code: string;
  lang: string;
  theme: "github-dark" | "github-light";
}) {
  const [html, setHtml] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    getHighlighter()
      .then((hl) => {
        if (cancelled) return;
        try {
          setHtml(hl.codeToHtml(code, { lang, theme }));
        } catch {
          setFailed(true);
        }
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [code, lang, theme]);

  if (html) {
    return (
      <div
        className="not-prose my-4 overflow-x-auto rounded-lg border border-border [&_pre]:!my-0"
        // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki produces escaped, trusted highlighting markup from the code string.
        dangerouslySetInnerHTML={{ __html: html }}
      />
    );
  }

  return (
    <pre
      className={`not-prose my-4 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm text-foreground ${
        failed ? "opacity-60" : ""
      }`}
    >
      <code className={`language-${lang}`}>{code}</code>
    </pre>
  );
}

interface MarkdownRendererProps {
  content: string;
  item?: { name: string; type: string; path?: string };
}

export function MarkdownRenderer({ content, item }: MarkdownRendererProps) {
  const theme = useThemeStore((s) => s.theme);
  const isDark = theme === "dark";
  const [current, setCurrent] = useState(content);
  const [draft, setDraft] = useState(content);
  const [editing, setEditing] = useState(false);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const setHeaderActions = useInboxHeaderActions();

  const startEditing = useCallback(() => {
    setDraft(current);
    setDirty(false);
    setSaved(false);
    setError(null);
    setEditing(true);
  }, [current]);

  const cancelEdit = useCallback(() => {
    setEditing(false);
    setDirty(false);
    setSaved(false);
    setError(null);
  }, []);

  const handleEditorChange = (value: string | undefined) => {
    const next = value ?? "";
    setDraft(next);
    setDirty(next !== current);
    setSaved(false);
  };

  const handleSave = useCallback(async () => {
    if (!item?.path) return;
    setSaving(true);
    setError(null);
    try {
      await updateInboxFile(item.path, draft);
      setCurrent(draft);
      setDirty(false);
      setSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save file");
    } finally {
      setSaving(false);
    }
  }, [draft, item]);

  useEffect(() => {
    setHeaderActions(
      editing ? (
        <>
          {saved && !dirty && (
            <span className="text-xs text-green-600 dark:text-green-400">Saved</span>
          )}
          <Button variant="ghost" size="sm" onClick={cancelEdit} disabled={saving}>
            <X className="h-4 w-4" />
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving || !dirty}>
            <Save className="h-4 w-4" />
            {saving ? "Saving..." : "Save"}
          </Button>
        </>
      ) : (
        <Button variant="ghost" size="sm" onClick={startEditing}>
          <FilePenLine className="h-4 w-4" />
          Edit
        </Button>
      ),
    );
    return () => setHeaderActions(null);
  }, [editing, saved, dirty, saving, startEditing, cancelEdit, handleSave, setHeaderActions]);

  const components: Components = {
    img: ({ src, alt }) => {
      const safeSource =
        typeof src === "string" && (src.startsWith("data:image/") || src.startsWith("blob:"))
          ? src
          : undefined;
      // biome-ignore lint/performance/noImgElement: Artifact data/blob images cannot use Next image optimization.
      return <img src={safeSource} alt={alt ?? ""} />;
    },
    a: ({ href, children }) => (
      <a href={safeLinkTarget(href)} rel="noopener noreferrer">
        {children}
      </a>
    ),
    pre: ({ children }) => <>{children}</>,
    code: ({ className, children }) => {
      const match = /language-(\w+)/.exec(className ?? "");
      const text = String(children);
      if (match) {
        return (
          <CodeBlock
            code={text.replace(/\n$/, "")}
            lang={match[1]}
            theme={isDark ? "github-dark" : "github-light"}
          />
        );
      }
      if (text.includes("\n")) {
        return (
          <pre className="not-prose my-4 overflow-x-auto rounded-lg border border-border bg-muted p-4 text-sm text-foreground">
            <code>{text}</code>
          </pre>
        );
      }
      return <code className={className}>{children}</code>;
    },
  };

  const renderPreview = (source: string) => (
    <div
      className={
        isDark
          ? "prose prose-invert prose-zinc max-w-none p-4 prose-headings:text-zinc-200 prose-p:text-zinc-300 prose-a:text-blue-400 prose-strong:text-zinc-200 prose-code:text-zinc-200 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-th:text-zinc-200 prose-td:text-zinc-300 prose-li:text-zinc-300 prose-blockquote:border-zinc-600 prose-blockquote:text-zinc-400"
          : "prose prose-zinc max-w-none p-4 prose-a:text-blue-600"
      }
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={components}>
        {source}
      </ReactMarkdown>
    </div>
  );

  return (
    <div className="flex h-full flex-col">
      {error && (
        <div className="mx-4 mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {editing ? (
        <div className="flex min-h-0 flex-1">
          <div className="h-full w-1/2 overflow-hidden border-r border-border">
            <MonacoEditor
              height="100%"
              language="markdown"
              theme={theme === "dark" ? "vs-dark" : "light"}
              value={draft}
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
          <div className="h-full w-1/2 overflow-auto">{renderPreview(draft)}</div>
        </div>
      ) : (
        <div className="flex-1 overflow-auto">{renderPreview(current)}</div>
      )}
    </div>
  );
}

function safeLinkTarget(href: string | undefined): string | undefined {
  if (!href) return undefined;
  return /^(?:https?:|mailto:|#|\/(?!\/))/iu.test(href) ? href : undefined;
}
