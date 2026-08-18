import { randomUUID } from "node:crypto";
import { createLogger, describeError } from "@agent-harness/core";
import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import { sessionManager } from "../session-manager.js";

export const chatRouter: Router = Router();

const logger = createLogger("server.chat");

const ChatRequestSchema = z
  .object({
    sessionId: IdentifierSchema,
    message: z.string().min(1).max(1_000_000),
    agentName: IdentifierSchema.optional(),
    retry: z.literal(true).optional(),
  })
  .strict();

chatRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const request = validateRequest(ChatRequestSchema, req.body, res);
    if (!request) return;
    const { sessionId, message, agentName, retry } = request;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const controller = new AbortController();
    const abortOnDisconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", abortOnDisconnect);

    // Skip tracking entirely when the session was already deleted. Otherwise
    // the controller lingers in the map (its set has been cleared) and would
    // be GC'd only by the next prepareSessionDeletion — a tiny leak with no
    // correctness impact, but easy to avoid.
    if (!sessionManager.isSessionAvailable(sessionId)) {
      res.write(
        `data: ${JSON.stringify({ type: "error", error: "Session is no longer available" })}\n\n`,
      );
      res.end();
      return;
    }

    sessionManager.trackSession(sessionId, controller);
    const requestId = randomUUID();
    try {
      const runtime = sessionManager.getOrCreate(sessionId);
      const result = retry
        ? await runtime.retry(message, agentName, controller.signal, requestId)
        : await runtime.deliver(message, agentName, controller.signal, requestId);
      const chunks = chunkSummary(result.summary);
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ type: "text-delta", text: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    } catch (error) {
      logger.error("Agent request failed", {
        requestId,
        sessionId,
        ...describeError(error),
      });
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Agent request failed" })}\n\n`);
      }
    } finally {
      sessionManager.clearSession(sessionId, controller);
      res.off("close", abortOnDisconnect);
    }

    if (!res.destroyed) res.end();
  }),
);

function chunkSummary(summary: string): string[] {
  if (summary.length === 0) return [""];
  const chunks: string[] = [];
  for (let offset = 0; offset < summary.length; offset += 40) {
    chunks.push(summary.slice(offset, offset + 40));
  }
  return chunks;
}
