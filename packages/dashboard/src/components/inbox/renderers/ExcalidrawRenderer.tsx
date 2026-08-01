'use client';

import dynamic from 'next/dynamic';
import { useEffect, useMemo, useRef, useState } from 'react';
import '@excalidraw/excalidraw/index.css';
import { updateInboxFile } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Save } from 'lucide-react';

const ExcalidrawComponent = dynamic(
  () => import('@excalidraw/excalidraw').then((mod) => mod.Excalidraw),
  {
    ssr: false,
    loading: () => (
      <div className="flex items-center justify-center h-full text-muted-foreground text-sm">
        Loading diagram viewer...
      </div>
    ),
  }
);

interface ExcalidrawScene {
  elements: unknown[];
  appState: unknown;
  files: unknown;
}

interface ExcalidrawRendererProps {
  content: string;
  item?: { name: string; type: string; path?: string };
}

export function ExcalidrawRenderer({ content, item }: ExcalidrawRendererProps) {
  const [parsed, setParsed] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDirty, setIsDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const sceneRef = useRef<ExcalidrawScene | null>(null);

  useEffect(() => {
    setParsed(null);
    setError(null);
    setIsDirty(false);
    setSaved(false);
    sceneRef.current = null;
    try {
      setParsed(JSON.parse(content));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }, [content]);

  const initialElementsJson = useMemo(
    () =>
      JSON.stringify(
        (parsed?.elements as unknown[] | undefined) ?? []
      ),
    [parsed]
  );

  const handleChange = (elements: any, appState: any, files: any) => {
    sceneRef.current = { elements, appState, files };
    setIsDirty(JSON.stringify(elements) !== initialElementsJson);
  };

  const handleSave = async () => {
    if (!sceneRef.current || !item?.path) return;
    setSaving(true);
    setError(null);
    try {
      const scene = {
        ...(parsed ?? {}),
        elements: sceneRef.current.elements,
        appState: sceneRef.current.appState,
        files: sceneRef.current.files ?? {},
      };
      await updateInboxFile(item.path, JSON.stringify(scene, null, 2));
      setIsDirty(false);
      setSaved(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to save diagram');
    } finally {
      setSaving(false);
    }
  };

  if (error && !parsed) {
    return (
      <div className="flex items-center justify-center h-full text-destructive text-sm">
        Failed to load Excalidraw: {error}
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b bg-background px-3 py-2">
        <span className="text-sm font-medium text-foreground truncate">
          {item?.name ?? 'Excalidraw'}
        </span>
        <Button size="sm" onClick={handleSave} disabled={!isDirty || saving}>
          <Save className="h-4 w-4" />
          {saving ? 'Saving...' : saved ? 'Saved' : 'Save'}
        </Button>
      </div>
      {error && (
        <div className="mx-2 mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      <div className="flex-1 min-h-0">
        <ExcalidrawComponent initialData={parsed} onChange={handleChange} />
      </div>
    </div>
  );
}
