'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

interface MarkdownRendererProps {
  content: string;
}

export function MarkdownRenderer({ content }: MarkdownRendererProps) {
  const [error, setError] = useState(false);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Failed to render markdown
      </div>
    );
  }

  try {
    return (
      <div className="overflow-auto h-full">
        <div className="prose prose-invert prose-zinc max-w-none p-4 prose-headings:text-zinc-200 prose-p:text-zinc-300 prose-a:text-blue-400 prose-strong:text-zinc-200 prose-code:text-zinc-200 prose-code:bg-zinc-800 prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-pre:bg-zinc-900 prose-pre:border prose-pre:border-zinc-800 prose-th:text-zinc-200 prose-td:text-zinc-300 prose-border-zinc-700 prose-li:text-zinc-300 prose-blockquote:border-zinc-600 prose-blockquote:text-zinc-400">
          <ReactMarkdown remarkPlugins={[remarkGfm]}>
            {content}
          </ReactMarkdown>
        </div>
      </div>
    );
  } catch {
    setError(true);
    return (
      <div className="flex items-center justify-center h-full text-zinc-500 text-sm">
        Failed to render markdown
      </div>
    );
  }
}
