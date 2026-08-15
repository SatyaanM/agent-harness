import { randomUUID } from "node:crypto";
import type { SessionData } from "@agent-harness/core";
import { getConfig, SessionStore } from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { hooks } from "../hooks.js";
import { asyncHandler } from "../http/async-handler.js";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import type { OpenSessionsState } from "../open-sessions.js";
import { loadOpenSessions, loadOpenSessionsForRepair, saveOpenSessions } from "../open-sessions.js";
import { sessionManager } from "../session-manager.js";
import { emitAgentEvent } from "../ws/events.js";

export const sessionsRouter = Router();

const SessionParamsSchema = z.object({ id: IdentifierSchema }).strict();
const OpenSessionsUpdateSchema = z
  .object({
    activeSessionId: IdentifierSchema.nullable().optional(),
    openSessionIds: z.array(IdentifierSchema).max(100).optional(),
  })
  .strict();
const SessionCreateSchema = z
  .object({
    prompt: z.string().max(1_000_000).default(""),
    agentName: IdentifierSchema.default("orchestrator"),
  })
  .strict();
const SessionRenameSchema = z.object({ title: z.string().max(512) }).strict();

function getSessionStore() {
  const config = getConfig();
  return new SessionStore(config.SESSIONS_DIR);
}

sessionsRouter.get(
  "/",
  asyncHandler(async (_req, res) => {
    const store = getSessionStore();
    await store.ensureIndexBuilt();
    res.json(await sortedSessionMeta(store));
  }),
);

sessionsRouter.get("/open", (_req, res) => {
  res.json(loadOpenSessions());
});

sessionsRouter.get(
  "/meta",
  asyncHandler(async (_req, res) => {
    const store = getSessionStore();
    await store.ensureIndexBuilt();
    res.json(await sortedSessionMeta(store));
  }),
);

sessionsRouter.get(
  "/diagnostics",
  asyncHandler(async (_req, res) => {
    const result = await getSessionStore().listWithDiagnostics();
    res.json(result.diagnostics);
  }),
);

sessionsRouter.put("/open", (req, res) => {
  const body = validateRequest(OpenSessionsUpdateSchema, req.body, res);
  if (!body) return;
  const prev = loadOpenSessionsForRepair();
  const openSessionIds = body.openSessionIds ?? prev.openSessionIds;
  const activeSessionId =
    body.activeSessionId !== undefined ? body.activeSessionId : prev.activeSessionId;
  const next: OpenSessionsState = { activeSessionId, openSessionIds };
  saveOpenSessions(next);

  const removed = prev.openSessionIds.filter((id) => !next.openSessionIds.includes(id));
  for (const sessionId of removed) {
    hooks.emit("session.closed", { sessionId });
  }

  res.json(next);
});

async function sortedSessionMeta(store: ReturnType<typeof getSessionStore>) {
  const metas = await store.listMeta();
  return metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
}

sessionsRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const request = validateRequest(SessionCreateSchema, req.body ?? {}, res);
    if (!request) return;
    const session: SessionData = {
      sessionId: randomUUID(),
      taskId: randomUUID(),
      prompt: request.prompt,
      agentName: request.agentName,
      messages: [],
      mailbox: [],
      createdAt: new Date().toISOString(),
    };
    await getSessionStore().save(session);
    hooks.emit("session.created", { sessionId: session.sessionId, agentName: session.agentName });
    res.status(201).json(session);
  }),
);

sessionsRouter.post(
  "/:id/open",
  asyncHandler(async (req, res) => {
    const params = validateRequest(SessionParamsSchema, req.params, res);
    if (!params) return;
    const sessionId = params.id;
    const store = getSessionStore();
    const session = await store.load(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }

    // Conditional drain (ADR §12.4): wake only when the durable mailbox holds
    // undelivered messages. Otherwise this is a history-only open — no runtime.
    const pendingCount = session.mailbox?.length ?? 0;
    let woke = false;
    if (pendingCount > 0) {
      const runtime = sessionManager.getOrCreate(sessionId);
      await runtime.deliver();
      woke = true;
    }

    hooks.emit("session.opened", { sessionId, woke, pendingCount });
    res.json({ woke, pendingCount });
  }),
);

sessionsRouter.get(
  "/:id",
  asyncHandler(async (req, res) => {
    const params = validateRequest(SessionParamsSchema, req.params, res);
    if (!params) return;
    const sessionId = params.id;
    const session = await getSessionStore().load(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    res.json(session);
  }),
);

sessionsRouter.patch(
  "/:id",
  asyncHandler(async (req, res) => {
    const params = validateRequest(SessionParamsSchema, req.params, res);
    if (!params) return;
    const body = validateRequest(SessionRenameSchema, req.body, res);
    if (!body) return;
    const sessionId = params.id;
    const { title } = body;
    const store = getSessionStore();
    const session = await store.load(sessionId);
    if (!session) {
      res.status(404).json({ error: "Session not found" });
      return;
    }
    if (title.trim() === "") {
      delete session.title;
    } else {
      session.title = title.trim();
    }
    await store.save(session);
    emitAgentEvent("session:updated", session);
    hooks.emit("session.renamed", { sessionId, title: session.title });
    res.json(session);
  }),
);

sessionsRouter.delete(
  "/:id",
  asyncHandler(async (req, res) => {
    const params = validateRequest(SessionParamsSchema, req.params, res);
    if (!params) return;
    const sessionId = params.id;
    await getSessionStore().delete(sessionId);
    hooks.emit("session.deleted", { sessionId });
    res.status(204).end();
  }),
);
