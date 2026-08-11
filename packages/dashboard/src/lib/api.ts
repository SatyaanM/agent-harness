import {
  AgentConfigSchema,
  PluginManifestSchema as CorePluginManifestSchema,
  type InboxRendererManifestSchema,
  type PluginCommandManifestSchema,
  parseJsonBoundary,
  parseJsonResponseBoundary,
  SessionDataSchema,
} from "@agent-harness/core/contracts";
import { z } from "zod";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

const SessionMetaSchema = z.object({
  sessionId: z.string().min(1),
  title: z.string().optional(),
  agentName: z.string().optional(),
  prompt: z.string(),
  createdAt: z.string().min(1),
  updatedAt: z.string().min(1),
  messageCount: z.number().int().nonnegative(),
});
const OpenSessionsStateSchema = z.object({
  activeSessionId: z.string().min(1).nullable(),
  openSessionIds: z.array(z.string().min(1)),
});
const OpenSessionResultSchema = z.object({
  woke: z.boolean(),
  pendingCount: z.number().int().nonnegative(),
});
const ErrorEnvelopeSchema = z.object({
  error: z.union([z.string(), z.object({ message: z.string() }).passthrough()]),
});
const ChatStreamEventSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("text-delta"), text: z.string() }).strict(),
  z.object({ type: z.literal("done") }).strict(),
  z.object({ type: z.literal("error"), error: z.string() }).strict(),
]);
export type ChatStreamEvent = z.infer<typeof ChatStreamEventSchema>;

async function parseJsonResponse<TSchema extends z.ZodTypeAny>(
  response: Response,
  schema: TSchema,
  boundary: string,
): Promise<z.output<TSchema>> {
  return parseJsonResponseBoundary(response, schema, boundary, 10_000_000);
}

export function parseChatStreamEvent(data: string): ChatStreamEvent {
  return parseJsonBoundary(ChatStreamEventSchema, data, "chat stream event");
}

export async function fetchSessions(): Promise<z.infer<typeof SessionDataSchema>[]> {
  const res = await fetch(`${BASE_URL}/api/sessions`);
  if (!res.ok) throw new Error("Failed to fetch sessions");
  return parseJsonResponse(res, z.array(SessionDataSchema), "sessions response");
}

export type SessionMeta = z.infer<typeof SessionMetaSchema>;

export async function fetchSessionMeta(): Promise<SessionMeta[]> {
  const res = await fetch(`${BASE_URL}/api/sessions/meta`);
  if (!res.ok) throw new Error("Failed to fetch session metadata");
  return parseJsonResponse(res, z.array(SessionMetaSchema), "session metadata response");
}

export type OpenSessionsState = z.infer<typeof OpenSessionsStateSchema>;

export async function fetchOpenSessions(): Promise<OpenSessionsState> {
  const res = await fetch(`${BASE_URL}/api/sessions/open`);
  if (!res.ok) throw new Error("Failed to fetch open sessions");
  return parseJsonResponse(res, OpenSessionsStateSchema, "open sessions response");
}

export async function updateOpenSessions(state: OpenSessionsState): Promise<OpenSessionsState> {
  const res = await fetch(`${BASE_URL}/api/sessions/open`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(state),
  });
  if (!res.ok) throw new Error("Failed to sync open sessions");
  return parseJsonResponse(res, OpenSessionsStateSchema, "open sessions update response");
}

export async function openSession(
  sessionId: string,
): Promise<{ woke: boolean; pendingCount: number }> {
  const res = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}/open`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to open session");
  return parseJsonResponse(res, OpenSessionResultSchema, "open session response");
}

export async function renameSession(sessionId: string, title: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (!res.ok) throw new Error("Failed to rename session");
}

export async function fetchSession(sessionId: string): Promise<z.infer<typeof SessionDataSchema>> {
  const res = await fetch(`${BASE_URL}/api/sessions/${encodeURIComponent(sessionId)}`);
  if (!res.ok) throw new Error("Failed to fetch session");
  return parseJsonResponse(res, SessionDataSchema, "session response");
}

export async function cancelWorker(taskId: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/workers/${encodeURIComponent(taskId)}/cancel`, {
    method: "POST",
  });
  if (!res.ok) throw new Error("Failed to cancel worker");
}

export async function createSession(): Promise<z.infer<typeof SessionDataSchema>> {
  const res = await fetch(`${BASE_URL}/api/sessions`, { method: "POST" });
  if (!res.ok) throw new Error("Failed to create session");
  return parseJsonResponse(res, SessionDataSchema, "create session response");
}

export interface InboxTreeEntry {
  name: string;
  path: string;
  absPath: string;
  type: "file" | "dir";
  size?: number;
  lastModified?: string;
  metadata?: unknown;
  children?: InboxTreeEntry[];
}
const InboxTreeEntrySchema: z.ZodType<InboxTreeEntry> = z.lazy(() =>
  z.object({
    name: z.string(),
    path: z.string(),
    absPath: z.string(),
    type: z.enum(["file", "dir"]),
    size: z.number().nonnegative().optional(),
    lastModified: z.string().optional(),
    metadata: z.unknown().optional(),
    children: z.array(InboxTreeEntrySchema).optional(),
  }),
);
const InboxItemSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  size: z.number().nonnegative(),
  lastModified: z.string(),
  content: z.string().optional(),
  metadata: z.unknown().optional(),
});
export type InboxItem = z.infer<typeof InboxItemSchema>;

export async function fetchInboxItems(): Promise<InboxItem[]> {
  const res = await fetch(`${BASE_URL}/api/inbox`);
  if (!res.ok) throw new Error(`Failed to fetch inbox items (${res.status})`);
  return parseJsonResponse(res, z.array(InboxItemSchema), "inbox items response");
}

export async function fetchInboxTree(): Promise<InboxTreeEntry[]> {
  const res = await fetch(`${BASE_URL}/api/inbox/tree`);
  if (!res.ok) throw new Error("Failed to fetch inbox tree");
  return parseJsonResponse(res, z.array(InboxTreeEntrySchema), "inbox tree response");
}

export async function fetchInboxFile(path: string): Promise<InboxItem> {
  const res = await fetch(`${BASE_URL}/api/inbox/file?path=${encodeURIComponent(path)}`);
  if (!res.ok) throw new Error("Inbox item not found");
  return parseJsonResponse(res, InboxItemSchema, "inbox file response");
}

export async function updateInboxFile(path: string, content: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/file?path=${encodeURIComponent(path)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!res.ok) throw new Error("Failed to save file");
}

export async function moveInboxItem(from: string, toDir: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/move`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: toDir }),
  });
  if (!res.ok) {
    const value: unknown = await parseJsonResponseBoundary(
      res,
      z.unknown(),
      "inbox move error",
      64_000,
    ).catch(() => null);
    const parsed = ErrorEnvelopeSchema.safeParse(value);
    const detail = parsed.success
      ? typeof parsed.data.error === "string"
        ? parsed.data.error
        : parsed.data.error.message
      : "Failed to move item";
    throw new Error(detail);
  }
}

export async function deleteInboxItem(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/file?path=${encodeURIComponent(path)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete item");
}

export async function createInboxDir(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/dir`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("Failed to create folder");
}

export async function openInboxItem(path: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/inbox/open`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path }),
  });
  if (!res.ok) throw new Error("Failed to open in explorer");
}

export async function sendMessage(
  sessionId: string,
  content: string,
  agentName?: string,
): Promise<ReadableStream<Uint8Array> | null> {
  const res = await fetch(`${BASE_URL}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message: content, agentName }),
  });
  if (!res.ok) throw new Error("Failed to send message");
  return res.body;
}

const HarnessSettingsSchema = z.object({
  ROOT: z.string(),
  INBOX_ROOT: z.string(),
  SESSIONS_DIR: z.string(),
  AGENTS_DIR: z.string(),
  PROVIDER_ENDPOINT: z.string().url(),
  API_KEY_ENV: z.string(),
  DEFAULT_MODEL: z.string(),
  MAX_CONCURRENT_AGENTS: z.number().int().positive(),
});
export type HarnessSettings = z.infer<typeof HarnessSettingsSchema>;

export async function fetchSettings(): Promise<HarnessSettings> {
  const res = await fetch(`${BASE_URL}/api/settings`);
  if (!res.ok) throw new Error("Failed to fetch settings");
  return parseJsonResponse(res, HarnessSettingsSchema, "settings response");
}

export async function updateSettings(settings: Partial<HarnessSettings>): Promise<HarnessSettings> {
  const res = await fetch(`${BASE_URL}/api/settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  if (!res.ok) throw new Error("Failed to update settings");
  return parseJsonResponse(res, HarnessSettingsSchema, "settings update response");
}

const ModelInfoSchema = z.object({
  id: z.string().min(1),
  object: z.string(),
  created: z.number(),
  owned_by: z.string(),
});
const ModelsResponseSchema = z.object({
  object: z.string(),
  data: z.array(ModelInfoSchema),
});
export type ModelInfo = z.infer<typeof ModelInfoSchema>;
export type ModelsResponse = z.infer<typeof ModelsResponseSchema>;

export async function fetchModels(): Promise<ModelsResponse> {
  const res = await fetch(`${BASE_URL}/api/settings/models`);
  if (!res.ok) throw new Error("Failed to fetch models");
  return parseJsonResponse(res, ModelsResponseSchema, "models response");
}

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

export async function fetchAgents(): Promise<AgentConfig[]> {
  const res = await fetch(`${BASE_URL}/api/agents`);
  if (!res.ok) throw new Error("Failed to fetch agents");
  return parseJsonResponse(res, z.array(AgentConfigSchema), "agents response");
}

export async function fetchAgent(name: string): Promise<AgentConfig> {
  const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error("Failed to fetch agent");
  return parseJsonResponse(res, AgentConfigSchema, "agent response");
}

export async function updateAgent(
  name: string,
  content: Partial<AgentConfig>,
): Promise<AgentConfig> {
  const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(content),
  });
  if (!res.ok) throw new Error("Failed to update agent");
  return parseJsonResponse(res, AgentConfigSchema, "agent update response");
}

export async function createAgent(
  name: string,
  content: Partial<AgentConfig>,
): Promise<AgentConfig> {
  const res = await fetch(`${BASE_URL}/api/agents`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name, ...content }),
  });
  if (!res.ok) throw new Error("Failed to create agent");
  return parseJsonResponse(res, AgentConfigSchema, "agent create response");
}

export async function deleteAgent(name: string): Promise<void> {
  const res = await fetch(`${BASE_URL}/api/agents/${encodeURIComponent(name)}`, {
    method: "DELETE",
  });
  if (!res.ok) throw new Error("Failed to delete agent");
}

const PluginManifestSchema = CorePluginManifestSchema.extend({ enabled: z.boolean() });
export type InboxRendererMeta = z.infer<typeof InboxRendererManifestSchema>;
export type PluginCommandManifest = z.infer<typeof PluginCommandManifestSchema>;
export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export async function fetchPlugins(): Promise<PluginManifest[]> {
  const res = await fetch(`${BASE_URL}/api/plugins`);
  if (!res.ok) throw new Error("Failed to fetch plugins");
  return parseJsonResponse(res, z.array(PluginManifestSchema), "plugins response");
}

export async function updatePlugin(name: string, enabled: boolean): Promise<PluginManifest> {
  const res = await fetch(`${BASE_URL}/api/plugins/${encodeURIComponent(name)}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ enabled }),
  });
  if (!res.ok) throw new Error("Failed to update plugin");
  return parseJsonResponse(res, PluginManifestSchema, "plugin update response");
}
