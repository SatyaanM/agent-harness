const BASE_URL = 'http://localhost:3001';

export async function fetchSessions() {
  const res = await fetch(`${BASE_URL}/api/sessions`);
  if (!res.ok) throw new Error('Failed to fetch sessions');
  return res.json();
}

export async function createSession() {
  const res = await fetch(`${BASE_URL}/api/sessions`, { method: 'POST' });
  if (!res.ok) throw new Error('Failed to create session');
  return res.json();
}

export async function sendMessage(
  sessionId: string,
  content: string
): Promise<ReadableStream<Uint8Array> | null> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sessionId, message: content }),
  });
  if (!res.ok) throw new Error('Failed to send message');
  return res.body;
}

export interface HarnessSettings {
  ROOT: string;
  INBOX_ROOT: string;
  SESSIONS_DIR: string;
  AGENTS_DIR: string;
  PROVIDER_ENDPOINT: string;
  API_KEY_ENV: string;
  DEFAULT_MODEL: string;
  MAX_CONCURRENT_AGENTS: number;
}

export async function fetchSettings(): Promise<HarnessSettings> {
  const res = await fetch(`${BASE_URL}/api/settings`);
  if (!res.ok) throw new Error('Failed to fetch settings');
  return res.json();
}

export async function updateSettings(settings: Partial<HarnessSettings>): Promise<HarnessSettings> {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error('Failed to update settings');
  return res.json();
}

export interface ModelInfo {
  id: string;
  object: string;
  created: number;
  owned_by: string;
}

export interface ModelsResponse {
  object: string;
  data: ModelInfo[];
}

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${BASE_URL}/api/settings/models`);
  if (!res.ok) throw new Error('Failed to fetch models');
  return res.json();
}

export interface AgentConfig {
  name: string;
  model: string;
  tools: string[];
  maxSteps: number;
  capabilities?: string[];
  modelIdMapping?: Record<string, string>;
  instructions?: string;
}

export async function fetchAgents(): Promise<AgentConfig[]> {
  const res = await fetch(`${BASE_URL}/api/agents`);
  if (!res.ok) throw new Error('Failed to fetch agents');
  return res.json();
}

export async function fetchAgent(name: string): Promise<AgentConfig> {
  const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error('Failed to fetch agent');
  return res.json();
}

export async function updateAgent(name: string, content: Partial<AgentConfig>): Promise<AgentConfig> {
  const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(content),
  });
  if (!res.ok) throw new Error('Failed to update agent');
  return res.json();
}

export async function createAgent(name: string, content: Partial<AgentConfig>): Promise<AgentConfig> {
  const res = await fetch(`${BASE_URL}/api/agents`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name, ...content }),
  });
  if (!res.ok) throw new Error('Failed to create agent');
  return res.json();
}

export async function deleteAgent(name: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete agent');
}
