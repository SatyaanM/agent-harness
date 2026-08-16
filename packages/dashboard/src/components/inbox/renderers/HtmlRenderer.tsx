"use client";

import { useMemo, useState } from "react";

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  const [error, setError] = useState(false);

  const srcDoc = useMemo(() => {
    const policy =
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:;\">";
    return `<!doctype html><html><head>${policy}</head><body>${content}</body></html>`;
  }, [content]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Failed to render HTML
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <iframe
        srcDoc={srcDoc}
        sandbox=""
        title="HTML preview"
        className="w-full h-full border-0 bg-white"
        onError={() => setError(true)}
      />
    </div>
  );
}
