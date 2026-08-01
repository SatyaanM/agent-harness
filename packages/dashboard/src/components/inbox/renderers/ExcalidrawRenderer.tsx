'use client';

import dynamic from 'next/dynamic';
import { useMemo, useState } from 'react';
import '@excalidraw/excalidraw/index.css';

const ExcalidrawComponent = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  { 
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
        Loading diagram viewer...
      </div>
    ),
  }
);

interface ExcalidrawRendererProps {
  content: string;
}

export function ExcalidrawRenderer({ content }: ExcalidrawRendererProps) {
  const [error, setError] = useState<string | null>(null);

  const initialData = useMemo(() => {
    try {
      const parsed = JSON.parse(content);
      return parsed;
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
      return null;
    }
  }, [content]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-red-400 text-sm">
        Failed to load Excalidraw: {error}
      </div>
    );
  }

  if (!ExcalidrawComponent) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400 text-sm">
        Excalidraw component not available
      </div>
    );
  }

  return (
    <div className="h-full w-full">
      <ExcalidrawComponent
        initialData={initialData}
        onChange={() => {}}
      />
    </div>
  );
}
