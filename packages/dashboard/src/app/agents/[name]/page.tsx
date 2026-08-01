'use client';

import { useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { fetchAgent, type AgentConfig } from '@/lib/api';
import { AgentConfigEditor } from '@/components/agents/AgentConfigEditor';
import { Button } from '@/components/ui/button';

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
      <div className="flex items-center justify-center h-full text-muted-foreground">
        Loading agent...
      </div>
    );
  }

  if (error || !agent) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-muted-foreground">{error ?? 'Agent not found'}</span>
        <Button variant="outline" onClick={() => router.push('/agents')}>
          Back to Agents
        </Button>
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
