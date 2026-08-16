"use client";

import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { usePluginStore } from "@/stores/plugin-store";

export default function PluginsPage() {
  const { plugins, isLoading, error, fetchPlugins, setPluginEnabled } = usePluginStore();
  const [toggling, setToggling] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  async function handleToggle(name: string, enabled: boolean) {
    setToggling(name);
    setActionError(null);
    try {
      await setPluginEnabled(name, enabled);
    } catch {
      setActionError(`Failed to update plugin "${name}"`);
    } finally {
      setToggling(null);
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="px-4 py-3 border-b bg-background">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">Plugins</h2>
      </div>

      {error && (
        <div className="mx-4 mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}
      {actionError && (
        <div className="mx-4 mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {actionError}
        </div>
      )}

      {isLoading && plugins.length === 0 ? (
        <div className="flex-1 space-y-2 p-4">
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
          <Skeleton className="h-20 w-full" />
        </div>
      ) : plugins.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">
          No plugins discovered
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-4 space-y-3">
          {plugins.map((plugin) => (
            <Card key={plugin.name}>
              <CardContent className="flex items-start justify-between gap-3 p-4">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-foreground font-medium truncate">
                      {plugin.name}
                    </span>
                    <Badge variant="secondary" className="shrink-0">
                      v{plugin.version}
                    </Badge>
                  </div>
                  {plugin.description && (
                    <p className="text-xs text-muted-foreground mt-0.5">{plugin.description}</p>
                  )}
                  <div className="flex flex-wrap gap-1.5 mt-2">
                    {(plugin.provides.inboxRenderers ?? []).map((renderer) => (
                      <Badge
                        key={renderer.component}
                        variant="outline"
                        className="text-[10px]"
                        title={`Renderer: ${renderer.label ?? renderer.component}`}
                      >
                        {renderer.extensions.join(", ")}
                      </Badge>
                    ))}
                  </div>
                </div>

                <Switch
                  checked={plugin.enabled}
                  disabled={toggling === plugin.name}
                  onCheckedChange={(checked) => handleToggle(plugin.name, checked)}
                  aria-label={`Toggle ${plugin.name}`}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
