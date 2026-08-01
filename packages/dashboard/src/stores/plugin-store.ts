import { create } from 'zustand';
import type { PluginManifest } from '@/lib/api';
import { fetchPlugins, updatePlugin } from '@/lib/api';

interface RendererEntry {
  componentKey: string;
  label?: string;
  plugin: string;
}

interface PluginState {
  plugins: PluginManifest[];
  rendererIndex: Record<string, RendererEntry>;
  isLoading: boolean;
  error: string | null;
  fetchPlugins: () => Promise<void>;
  setPluginEnabled: (name: string, enabled: boolean) => Promise<void>;
  getRenderer: (ext: string) => RendererEntry | null;
}

function buildRendererIndex(
  plugins: PluginManifest[]
): Record<string, RendererEntry> {
  const index: Record<string, RendererEntry> = {};
  for (const plugin of plugins) {
    if (!plugin.enabled) continue;
    for (const renderer of plugin.provides.inboxRenderers ?? []) {
      for (const ext of renderer.extensions) {
        index[ext.toLowerCase()] = {
          componentKey: renderer.component,
          label: renderer.label,
          plugin: plugin.name,
        };
      }
    }
  }
  return index;
}

export const usePluginStore = create<PluginState>((set, get) => ({
  plugins: [],
  rendererIndex: {},
  isLoading: false,
  error: null,
  fetchPlugins: async () => {
    set({ isLoading: true, error: null });
    try {
      const plugins = await fetchPlugins();
      set({
        plugins,
        rendererIndex: buildRendererIndex(plugins),
        isLoading: false,
      });
    } catch (err) {
      set({
        isLoading: false,
        error:
          err instanceof Error ? err.message : 'Failed to load plugins',
      });
    }
  },
  getRenderer: (ext) => get().rendererIndex[ext.toLowerCase()] ?? null,

  setPluginEnabled: async (name, enabled) => {
    set((state) => {
      const plugins = state.plugins.map((p) =>
        p.name === name ? { ...p, enabled } : p
      );
      return { plugins, rendererIndex: buildRendererIndex(plugins) };
    });
    try {
      const updated = await updatePlugin(name, enabled);
      set((state) => {
        const plugins = state.plugins.map((p) =>
          p.name === updated.name ? updated : p
        );
        return { plugins, rendererIndex: buildRendererIndex(plugins) };
      });
    } catch (err) {
      set((state) => {
        const plugins = state.plugins.map((p) =>
          p.name === name ? { ...p, enabled: !enabled } : p
        );
        return { plugins, rendererIndex: buildRendererIndex(plugins) };
      });
      throw err;
    }
  },
}));
