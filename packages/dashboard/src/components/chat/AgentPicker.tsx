"use client";

import { Bot } from "lucide-react";
import { useEffect } from "react";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAgentsStore } from "@/stores/agents-store";
import { useSessionStore } from "@/stores/session-store";

function isOrchestrator(tools: string[]): boolean {
  return tools.includes("delegate");
}

export default function AgentPicker() {
  const agents = useAgentsStore((s) => s.agents);
  const loading = useAgentsStore((s) => s.loading);
  const fetchAgents = useAgentsStore((s) => s.fetch);
  const activeSessionId = useSessionStore((s) => s.activeSessionId);
  const sessions = useSessionStore((s) => s.sessions);
  const setAgentName = useSessionStore((s) => s.setAgentName);

  useEffect(() => {
    if (agents.length === 0) fetchAgents();
  }, [agents.length, fetchAgents]);

  const activeSession = sessions.find((s) => s.sessionId === activeSessionId);
  const value = activeSession?.agentName ?? "orchestrator";

  if (!activeSessionId || loading) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-zinc-400 dark:text-zinc-500">
        <Bot className="h-3.5 w-3.5" />
        {activeSessionId ? "Loading agents…" : "Create a session first"}
      </div>
    );
  }

  return (
    <Select value={value} onValueChange={(name) => setAgentName(activeSessionId, name)}>
      <SelectTrigger className="h-7 w-44 text-xs" aria-label="Select agent">
        <Bot className="h-3.5 w-3.5 shrink-0" />
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {agents.map((agent) => (
          <SelectItem key={agent.name} value={agent.name}>
            <span className="flex flex-col">
              <span className="flex items-center gap-2">
                {agent.name}
                {isOrchestrator(agent.tools) && (
                  <span className="rounded bg-blue-100 px-1 text-[10px] font-medium text-blue-700 dark:bg-blue-900/50 dark:text-blue-300">
                    orchestrator
                  </span>
                )}
              </span>
              {agent.description && (
                <span className="text-xs text-muted-foreground">{agent.description}</span>
              )}
            </span>
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
