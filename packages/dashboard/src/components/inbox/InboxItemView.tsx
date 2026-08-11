"use client";

import { type ReactNode, useCallback, useMemo, useState } from "react";
import { fallbackRenderer, resolveRenderer } from "@/plugins/registry";
import type { InboxItem } from "@/stores/inbox-store";
import { usePluginStore } from "@/stores/plugin-store";
import { InboxHeaderActionsContext } from "./header-actions";

interface InboxItemViewProps {
  item: InboxItem;
}

export function InboxItemView({ item }: InboxItemViewProps) {
  const content = item.content ?? "";
  const type = item.type.toLowerCase();
  const getRenderer = usePluginStore((s) => s.getRenderer);
  const [headerActions, setHeaderActions] = useState<ReactNode>(null);
  const setHeaderActionsStable = useCallback((node: ReactNode | null) => {
    setHeaderActions(node);
  }, []);

  const rendererItem = useMemo(
    () => ({ name: item.name, type: item.type, path: item.id }),
    [item.name, item.type, item.id],
  );

  const entry = getRenderer(type);
  const Renderer = entry
    ? (resolveRenderer(entry.componentKey) ?? fallbackRenderer)
    : fallbackRenderer;

  return (
    <InboxHeaderActionsContext.Provider value={setHeaderActionsStable}>
      <div className="flex flex-col h-full">
        <div className="flex items-center justify-between gap-2 px-4 py-2 border-b bg-background">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground truncate">{item.name}</h2>
            <p className="text-xs text-muted-foreground mt-0.5 uppercase">{item.type}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">{headerActions}</div>
        </div>
        <div className="flex-1 overflow-auto p-4">
          <Renderer content={content} item={rendererItem} />
        </div>
      </div>
    </InboxHeaderActionsContext.Provider>
  );
}
