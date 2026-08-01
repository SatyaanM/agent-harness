const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

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

export interface InboxItem {
  id: string;
  name: string;
  type: string;
  size: number;
  lastModified: string;
  content?: string;
  metadata?: unknown;
}

export interface InboxTreeEntry {
  name: string;
  path: string;
  absPath: string;
  type: 'file' | 'dir';
  size?: number;
  lastModified?: string;
  metadata?: unknown;
  children?: InboxTreeEntry[];
}

export async function fetchInboxTree(): Promise<InboxTreeEntry[]> {
  const res = await fetch(`${BASE_URL}/api/inbox/tree`);
  if (!res.ok) throw new Error('Failed to fetch inbox tree');
  return res.json();
}

export async function fetchInboxFile(path: string): Promise<InboxItem> {
  const res = await fetch(`${BASE_URL}/api/inbox/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error('Inbox item not found');
  return res.json();
}

export async function updateInboxFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/file?path=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error('Failed to save file');
}

export async function moveInboxItem(from: string, toDir: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/move`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to: toDir }),
  });
  if (!res.ok) {
    const data = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(data?.error ?? 'Failed to move item');
  }
}

export async function deleteInboxItem(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/file?path=${encodeURIComponent(path)}`, {
    method: 'DELETE',
  });
  if (!res.ok) throw new Error('Failed to delete item');
}

export async function createInboxDir(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/dir`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error('Failed to create folder');
}

export async function openInboxItem(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/open`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error('Failed to open in explorer');
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

export interface InboxRendererMeta {
  extensions: string[];
  component: string;
  label?: string;
}

export interface PluginManifest {
  name: string;
  version: string;
  description?: string;
  enabled: boolean;
  provides: {
    inboxRenderers?: InboxRendererMeta[];
  };
}

export async function fetchPlugins(): Promise<PluginManifest[]> {
  const res = await fetch(`${BASE_URL}/api/plugins`);
  if (!res.ok) throw new Error('Failed to fetch plugins');
  return res.json();
}

export async function updatePlugin(
  name: string,
  enabled: boolean
): Promise<PluginManifest> {
  const res = await fetch(`${BASE_URL}/api/plugins/${encodeURIComponent(name)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error('Failed to update plugin');
  return res.json();
}
