'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAgents, createAgent, type AgentConfig } from '@/lib/api';

export default function AgentsPage() {
  const [agents, setAgents] = useState<AgentConfig[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const router = useRouter();

  useEffect(() => {
    loadAgents();
  }, []);

  async function loadAgents() {
    setLoading(true);
    try {
      const data = await fetchAgents();
      setAgents(data);
    } catch {
      setError('Failed to load agents');
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate() {
    if (!newName.trim()) return;
    setCreating(true);
    setError(null);
    try {
      await createAgent(newName.trim(), {
        name: newName.trim(),
        model: 'qwen3.7-plus',
        tools: [],
        maxSteps: 10,
        instructions: '',
      });
      setShowCreate(false);
      setNewName('');
      router.push(`/agents/${encodeURIComponent(newName.trim())}`);
    } catch {
      setError('Failed to create agent');
    } finally {
      setCreating(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400">
        Loading agents...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800">
        <h2 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Agents
        </h2>
        <button
          onClick={() => setShowCreate(true)}
          className="rounded bg-blue-600 px-3 py-1 text-xs font-medium text-white transition-colors hover:bg-blue-700"
        >
          + New Agent
        </button>
      </div>

      {showCreate && (
        <div className="flex items-center gap-2 border-b border-zinc-800 px-4 py-2">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Agent name..."
            autoFocus
            className="flex-1 rounded border border-zinc-700 bg-zinc-900 px-3 py-1.5 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-blue-500"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <button
            onClick={handleCreate}
            disabled={creating || !newName.trim()}
            className="rounded bg-blue-600 px-3 py-1.5 text-xs font-medium text-white disabled:opacity-50"
          >
            {creating ? '...' : 'Create'}
          </button>
          <button
            onClick={() => { setShowCreate(false); setNewName(''); }}
            className="rounded px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200"
          >
            Cancel
          </button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 rounded border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-zinc-500">
          No agents configured yet
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {agents.map((agent) => (
            <li key={agent.name}>
              <button
                onClick={() => router.push(`/agents/${encodeURIComponent(agent.name)}`)}
                className="w-full text-left px-4 py-3 border-b border-zinc-800/50 hover:bg-zinc-800/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-zinc-200 font-medium truncate">
                    {agent.name}
                  </span>
                  <span className="text-xs text-zinc-500 shrink-0">
                    {agent.tools?.length ?? 0} tools
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs text-zinc-500">{agent.model}</span>
                  <span className="text-xs text-zinc-600">
                    max {agent.maxSteps ?? 10} steps
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
