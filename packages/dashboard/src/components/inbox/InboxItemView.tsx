'use client';

import type { InboxItem } from '@/stores/inbox-store';
import { usePluginStore } from '@/stores/plugin-store';
import { resolveRenderer, fallbackRenderer } from '@/plugins/registry';

interface InboxItemViewProps {
  item: InboxItem;
}

export function InboxItemView({ item }: InboxItemViewProps) {
  const content = item.content ?? '';
  const type = item.type.toLowerCase();
  const getRenderer = usePluginStore((s) => s.getRenderer);

  const entry = getRenderer(type);
  const Renderer = entry
    ? resolveRenderer(entry.componentKey) ?? fallbackRenderer
    : fallbackRenderer;

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b bg-background">
        <h2 className="text-sm font-semibold text-foreground truncate">
          {item.name}
        </h2>
        <p className="text-xs text-muted-foreground mt-0.5 uppercase">{item.type}</p>
      </div>
      <div className="flex-1 overflow-auto p-4">
        <Renderer
          content={content}
          item={{ name: item.name, type: item.type }}
        />
      </div>
    </div>
  );
}
