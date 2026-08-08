import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getConfig, SessionStore } from "@agent-harness/core";
import type { SessionData } from "@agent-harness/core";
import { sessionManager } from "../session-manager.js";
import { hooks } from "../hooks.js";
import { loadOpenSessions, saveOpenSessions } from "../open-sessions.js";
import type { OpenSessionsState } from "../open-sessions.js";
import { emitAgentEvent } from "../ws/events.js";

export const sessionsRouter = Router();

function getSessionStore() {
  const config = getConfig();
  return new SessionStore(config.SESSIONS_DIR);
}

sessionsRouter.get("/", async (_req, res) => {
  const sessions = await getSessionStore().list();
  res.json(sessions);
});

sessionsRouter.get("/open", (_req, res) => {
  res.json(loadOpenSessions());
});

sessionsRouter.get("/meta", async (_req, res) => {
  const store = getSessionStore();
  await store.ensureIndexBuilt();
  const metas = await store.listMeta();
  res.json(metas.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()));
});

sessionsRouter.put("/open", (req, res) => {
  const body = req.body as Partial<OpenSessionsState>;
  const prev = loadOpenSessions();
  const openSessionIds = Array.isArray(body.openSessionIds)
    ? body.openSessionIds.filter((id): id is string => typeof id === "string")
    : prev.openSessionIds;
  const activeSessionId =
    typeof body.activeSessionId === "string" ? body.activeSessionId : null;
  const next: OpenSessionsState = { activeSessionId, openSessionIds };
  saveOpenSessions(next);

  const removed = prev.openSessionIds.filter((id) => !next.openSessionIds.includes(id));
  for (const sessionId of removed) {
    hooks.emit("session.closed", { sessionId });
  }

  res.json(next);
});

sessionsRouter.post("/", async (req, res) => {
  const session: SessionData = {
    sessionId: randomUUID(),
    taskId: randomUUID(),
    prompt: req.body["prompt"] ?? "",
    agentName: req.body["agentName"] ?? "orchestrator",
    messages: [],
    mailbox: [],
    createdAt: new Date().toISOString(),
  };
  await getSessionStore().save(session);
  hooks.emit("session.created", { sessionId: session.sessionId, agentName: session.agentName });
  res.status(201).json(session);
});

sessionsRouter.post("/:id/open", async (req, res) => {
  const sessionId = req.params["id"]!;
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
});

sessionsRouter.get("/:id", async (req, res) => {
  const session = await getSessionStore().load(req.params["id"]!);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

sessionsRouter.patch("/:id", async (req, res) => {
  const sessionId = req.params["id"]!;
  const title = req.body?.["title"];
  if (typeof title !== "string") {
    res.status(400).json({ error: "title is required" });
    return;
  }
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
});

sessionsRouter.delete("/:id", async (req, res) => {
  const sessionId = req.params["id"]!;
  await getSessionStore().delete(sessionId);
  hooks.emit("session.deleted", { sessionId });
  res.status(204).end();
});
