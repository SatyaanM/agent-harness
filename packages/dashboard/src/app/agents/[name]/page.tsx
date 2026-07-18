'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchAgent, type AgentConfig } from '@/lib/api';
import { AgentConfigEditor } from '@/components/agents/AgentConfigEditor';

export default function AgentEditorPage() {
  const params = useParams();
  const router = useRouter();
  const name = decodeURIComponent(params.name as string);
  const [agent, setAgent] = useState<AgentConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetchAgent(name)
      .then(setAgent)
      .catch(() => setError('Failed to load agent'))
      .finally(() => setLoading(false));
  }, [name]);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-zinc-400">
        Loading agent...
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-zinc-500">{error ?? 'Agent not found'}</span>
        <button
          onClick={() => router.push('/agents')}
          className="rounded bg-zinc-800 px-3 py-1.5 text-sm text-zinc-300 hover:bg-zinc-700"
        >
          Back to Agents
        </button>
      </div>
    );
  }

  return (
    <div className="h-full">
      <AgentConfigEditor
        agentName={name}
        initialConfig={agent}
        onDeleted={() => router.push('/agents')}
        onSaved={(updated) => setAgent(updated)}
      />
    </div>
  );
}
