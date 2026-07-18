import { Router } from "express";
import { randomUUID } from "node:crypto";
import { getConfig, SessionStore } from "@agent-harness/core";
import type { SessionData } from "@agent-harness/core";

export const sessionsRouter = Router();

function getSessionStore() {
  const config = getConfig();
  return new SessionStore(config.SESSIONS_DIR);
}

sessionsRouter.get("/", async (_req, res) => {
  const sessions = await getSessionStore().list();
  res.json(sessions);
});

sessionsRouter.get("/:id", async (req, res) => {
  const session = await getSessionStore().load(req.params["id"]!);
  if (!session) {
    res.status(404).json({ error: "Session not found" });
    return;
  }
  res.json(session);
});

sessionsRouter.post("/", async (req, res) => {
  const session: SessionData = {
    sessionId: randomUUID(),
    taskId: randomUUID(),
    prompt: req.body["prompt"] ?? "",
    messages: [],
    createdAt: new Date().toISOString(),
  };
  await getSessionStore().save(session);
  res.status(201).json(session);
});

sessionsRouter.delete("/:id", async (req, res) => {
  await getSessionStore().delete(req.params["id"]!);
  res.status(204).end();
});
