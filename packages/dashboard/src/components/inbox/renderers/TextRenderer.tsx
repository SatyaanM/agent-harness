"use client";

import { useEffect, useMemo, useState } from "react";
import { createHighlighter, type Highlighter } from "shiki";

interface TextRendererProps {
  content: string;
  language?: string;
  item?: { name: string };
}

const EXTENSION_MAP: Record<string, string> = {
  ts: "typescript",
  tsx: "typescript",
  js: "javascript",
  jsx: "javascript",
  json: "json",
  yaml: "yaml",
  yml: "yaml",
  py: "python",
  rb: "ruby",
  rs: "rust",
  go: "go",
  html: "html",
  css: "css",
  scss: "scss",
  md: "markdown",
  sh: "shell",
  bash: "shell",
  xml: "xml",
  sql: "sql",
  graphql: "graphql",
  toml: "toml",
  ini: "ini",
  txt: "text",
  log: "text",
};

export function resolveLanguage(language?: string, itemName?: string): string {
  if (language && language !== "text") return language;
  const extension = itemName?.split(".").pop()?.toLowerCase();
  if (extension && EXTENSION_MAP[extension]) return EXTENSION_MAP[extension];
  return "text";
}

export function TextRenderer({ content, language, item }: TextRendererProps) {
  const [highlighter, setHighlighter] = useState<Highlighter | null>(null);
  const [error, setError] = useState<string | null>(null);

  const resolvedLang = useMemo(() => resolveLanguage(language, item?.name), [language, item?.name]);

  useEffect(() => {
    let cancelled = false;
    createHighlighter({
      themes: ["github-dark"],
      langs: [resolvedLang === "text" ? "typescript" : resolvedLang],
    })
      .then((h) => {
        if (!cancelled) setHighlighter(h);
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load highlighter");
      });
    return () => {
      cancelled = true;
    };
  }, [resolvedLang]);

  const lines = useMemo(() => content.split("\n"), [content]);

  if (content.length === 0) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-zinc-500">
        This file is empty
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Failed to render: {error}
      </div>
    );
  }

  if (!highlighter) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
        Loading...
      </div>
    );
  }

  const highlighted =
    resolvedLang === "text"
      ? null
      : (() => {
          try {
            return highlighter.codeToHtml(content, { lang: resolvedLang, theme: "github-dark" });
          } catch {
            return null;
          }
        })();

  return (
    <div className="flex-1 overflow-auto">
      {highlighted ? (
        <div className="flex">
          <div className="shrink-0 px-3 py-4 text-right select-none border-r border-zinc-800 bg-zinc-900/50">
            {lines.map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Line numbers are the stable identity of this immutable rendered text.
              <div key={i} className="text-xs leading-5 text-zinc-600 font-mono">
                {i + 1}
              </div>
            ))}
          </div>
          <div
            className="flex-1 overflow-x-auto px-4 py-4 [&_pre]:!bg-transparent [&_pre]:!p-0 [&_pre]:!m-0 [&_code]:!text-sm [&_code]:!leading-5"
            // biome-ignore lint/security/noDangerouslySetInnerHtml: Shiki produces escaped, trusted highlighting markup from the text content.
            dangerouslySetInnerHTML={{ __html: highlighted }}
          />
        </div>
      ) : (
        <div className="flex">
          <div className="shrink-0 px-3 py-4 text-right select-none border-r border-zinc-800 bg-zinc-900/50">
            {lines.map((_, i) => (
              // biome-ignore lint/suspicious/noArrayIndexKey: Line numbers are the stable identity of this immutable rendered text.
              <div key={i} className="text-xs leading-5 text-zinc-600 font-mono">
                {i + 1}
              </div>
            ))}
          </div>
          <pre className="flex-1 px-4 py-4 text-sm leading-5 text-zinc-300 font-mono whitespace-pre overflow-x-auto">
            {content}
          </pre>
        </div>
      )}
    </div>
  );
}

export { EXTENSION_MAP };
