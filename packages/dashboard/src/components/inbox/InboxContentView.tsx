"use client";

import { useEffect, useState } from "react";
import { fetchInboxFile, type InboxItem } from "@/lib/api";
import { useInboxWorkspaceStore } from "@/stores/inbox-workspace-store";
import { InboxItemView } from "./InboxItemView";

export function InboxContentView() {
  const selectedPath = useInboxWorkspaceStore((s) => s.selectedPath);
  const [item, setItem] = useState<InboxItem | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (!selectedPath) {
      setItem(null);
      setIsLoading(false);
      setError(null);
      return;
    }

    setIsLoading(true);
    setError(null);
    setItem(null);

    fetchInboxFile(selectedPath)
      .then((data) => {
        if (!cancelled) setItem(data);
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "Failed to load item");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedPath]);

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Select a file to view it
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        Loading...
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-4">
        <div className="text-destructive text-sm">{error}</div>
      </div>
    );
  }

  if (!item) return null;

  return <InboxItemView item={item} />;
}
