import { randomUUID } from "node:crypto";
import type { SessionData } from "@agent-harness/core";
import {
  getConfig,
  MailboxRepository,
  OpenSessionsRepository,
  SessionRepository,
  SessionStore,
} from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { hooks } from "../hooks.js";
import { asyncHandler } from "../http/async-handler.js";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import type { OpenSessionsState } from "../open-sessions.js";
import {
  loadOpenSessions,
  loadOpenSessionsForRepair,
  OpenSessionsStateSchema,
  saveOpenSessions,
} from "../open-sessions.js";
import { sessionManager } from "../session-manager.js";
import { emitAgentEvent } from "../ws/events.js";

export const sessionsRouter: Router = Router();

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
    const db = sessionManager.getDb();
    if (db) {
      const sessionRepo = new SessionRepository(db);
      const metas = sessionRepo.listMeta();
      res.json(
        metas.map((m) => ({
          sessionId: m.id,
          prompt: m.prompt,
          agentName: m.agentName,
          title: m.title ?? undefined,
          createdAt: new Date(m.createdAt).toISOString(),
          updatedAt: new Date(m.updatedAt).toISOString(),
          completedAt: m.completedAt ? new Date(m.completedAt).toISOString() : undefined,
          messageCount: m.messageCount,
        })),
      );
      return;
    }
    const store = getSessionStore();
    await store.ensureIndexBuilt();
    res.json(await sortedSessionMeta(store));
  }),
);

sessionsRouter.get("/open", (_req, res) => {
  const db = sessionManager.getDb();
  if (db) {
    const openRepo = new OpenSessionsRepository(db);
    const rows = openRepo.getAll();
    const active = rows.find((r) => r.is_active === 1)?.session_id ?? null;
    res.json({
      activeSessionId: active,
      openSessionIds: rows.map((r) => r.session_id),
    });
    return;
  }
  res.json(loadOpenSessions());
});

sessionsRouter.get(
  "/meta",
  asyncHandler(async (_req, res) => {
    const db = sessionManager.getDb();
    if (db) {
      const sessionRepo = new SessionRepository(db);
      const metas = sessionRepo.listMeta();
      res.json(
        metas.map((m) => ({
          sessionId: m.id,
          prompt: m.prompt,
          agentName: m.agentName,
          title: m.title ?? undefined,
          createdAt: new Date(m.createdAt).toISOString(),
          updatedAt: new Date(m.updatedAt).toISOString(),
          completedAt: m.completedAt ? new Date(m.completedAt).toISOString() : undefined,
          messageCount: m.messageCount,
        })),
      );
      return;
    }
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

sessionsRouter.put(
  "/open",
  asyncHandler(async (req, res) => {
    const body = validateRequest(OpenSessionsUpdateSchema, req.body, res);
    if (!body) return;
    const prev = loadOpenSessionsForRepair();
    const openSessionIds = body.openSessionIds ?? prev.openSessionIds;
    const activeSessionId =
      body.activeSessionId !== undefined ? body.activeSessionId : prev.activeSessionId;
    const next = validateRequest(
      OpenSessionsStateSchema,
      { activeSessionId, openSessionIds } satisfies OpenSessionsState,
      res,
    );
    if (!next) return;

    const removed = prev.openSessionIds.filter((id) => !next.openSessionIds.includes(id));
    for (const sessionId of removed) {
      await hooks.runBefore("session.beforeClose", { sessionId });
    }

    const db = sessionManager.getDb();
    if (db) {
      const openRepo = new OpenSessionsRepository(db);
      const rows = next.openSessionIds.map((id, idx) => ({
        sessionId: id,
        tabOrder: idx,
        isActive: id === next.activeSessionId,
      }));
      openRepo.setAll(rows);
    }
    saveOpenSessions(next);

    for (const sessionId of removed) {
      sessionManager.unload(sessionId);
      hooks.emit("session.closed", { sessionId });
    }

    res.json(next);
  }),
);

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
    const db = sessionManager.getDb();
    if (db) {
      new SessionRepository(db).create({
        id: session.sessionId,
        agentName: session.agentName ?? "orchestrator",
        prompt: session.prompt,
      });
    }
    sessionManager.markSessionCreated(session.sessionId);
    sessionManager.audit({
      actorType: "user",
      actorId: "user",
      action: "session.create",
      resourceType: "session",
      resourceId: session.sessionId,
      payload: { prompt: session.prompt, agentName: session.agentName },
    });
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
    const db = sessionManager.getDb();
    const pendingCount = db
      ? new MailboxRepository(db).countPending(sessionId)
      : (session.mailbox?.length ?? 0);
    let woke = false;
    if (pendingCount > 0) {
      sessionManager.wake(sessionId);
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
      session.title = undefined;
    } else {
      session.title = title.trim();
    }
    await store.save(session);
    const db = sessionManager.getDb();
    if (db) {
      new SessionRepository(db).update(sessionId, {
        title: session.title ?? null,
      });
    }
    emitAgentEvent("session:updated", session);
    sessionManager.audit({
      actorType: "user",
      actorId: "user",
      action: "session.rename",
      resourceType: "session",
      resourceId: sessionId,
      payload: { title: session.title },
    });
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
    await hooks.runBefore("session.beforeDelete", { sessionId });
    sessionManager.prepareSessionDeletion(sessionId);
    try {
      await getSessionStore().delete(sessionId);
      const db = sessionManager.getDb();
      if (db) {
        new SessionRepository(db).delete(sessionId);
      }
    } catch (error) {
      sessionManager.markSessionCreated(sessionId);
      throw error;
    }
    sessionManager.audit({
      actorType: "user",
      actorId: "user",
      action: "session.delete",
      resourceType: "session",
      resourceId: sessionId,
      payload: {},
    });
    hooks.emit("session.deleted", { sessionId });
    res.status(204).end();
  }),
);
