'use client';

import { useState, useMemo } from 'react';

interface HtmlRendererProps {
  content: string;
}

export function HtmlRenderer({ content }: HtmlRendererProps) {
  const [error, setError] = useState(false);

  const srcDoc = useMemo(() => content, [content]);

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
        sandbox="allow-scripts"
        title="HTML preview"
        className="w-full h-full border-0 bg-white"
        onError={() => setError(true)}
      />
    </div>
  );
}
