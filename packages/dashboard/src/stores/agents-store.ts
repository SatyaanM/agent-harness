import { create } from 'zustand';
import { fetchAgents, type AgentConfig } from '@/lib/api';

interface AgentsState {
  agents: AgentConfig[];
  loading: boolean;
  error: string | null;
  fetch: () => Promise<void>;
}

export const useAgentsStore = create<AgentsState>((set) => ({
  agents: [],
  loading: false,
  error: null,
  fetch: async () => {
    set({ loading: true, error: null });
    try {
      const agents = await fetchAgents();
      set({ agents, loading: false });
    } catch (err) {
      set({
        error: err instanceof Error ? err.message : 'Failed to load agents',
        loading: false,
      });
    }
  },
}));
