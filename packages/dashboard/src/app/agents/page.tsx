'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { fetchAgents, createAgent, type AgentConfig } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

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
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading agents...
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between px-4 py-3 border-b bg-background">
        <h2 className="text-sm font-semibold text-foreground uppercase tracking-wider">
          Agents
        </h2>
        <Button size="sm" onClick={() => setShowCreate(true)}>
          + New Agent
        </Button>
      </div>

      {showCreate && (
        <div className="flex items-center gap-2 border-b px-4 py-2">
          <Input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="Agent name..."
            autoFocus
            className="flex-1"
            onKeyDown={(e) => { if (e.key === 'Enter') handleCreate(); }}
          />
          <Button onClick={handleCreate} disabled={creating || !newName.trim()} size="sm">
            {creating ? '...' : 'Create'}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setShowCreate(false); setNewName(''); }}
          >
            Cancel
          </Button>
        </div>
      )}

      {error && (
        <div className="mx-4 mt-2 rounded border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {error}
        </div>
      )}

      {agents.length === 0 ? (
        <div className="flex items-center justify-center flex-1 text-muted-foreground">
          No agents configured yet
        </div>
      ) : (
        <ul className="flex-1 overflow-y-auto">
          {agents.map((agent) => (
            <li key={agent.name}>
              <button
                onClick={() => router.push(`/agents/${encodeURIComponent(agent.name)}`)}
                className="w-full text-left px-4 py-3 border-b hover:bg-muted/50 transition-colors"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm text-foreground font-medium truncate">
                    {agent.name}
                  </span>
                  <span className="text-xs text-muted-foreground shrink-0">
                    {agent.tools?.length ?? 0} tools
                  </span>
                </div>
                <div className="flex items-center justify-between gap-2 mt-1">
                  <span className="text-xs text-muted-foreground">{agent.model}</span>
                  <span className="text-xs text-muted-foreground/70">
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
