'use client';

import { useEffect } from 'react';
import { usePluginStore } from '@/stores/plugin-store';

export function PluginProvider({ children }: { children: React.ReactNode }) {
  const fetchPlugins = usePluginStore((s) => s.fetchPlugins);

  useEffect(() => {
    fetchPlugins();
  }, [fetchPlugins]);

  return <>{children}</>;
}
