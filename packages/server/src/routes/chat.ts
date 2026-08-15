import { Router } from "express";
import { z } from "zod";
import { asyncHandler } from "../http/async-handler.js";
import { IdentifierSchema, validateRequest } from "../http/validation.js";
import { sessionManager } from "../session-manager.js";

export const chatRouter = Router();

const ChatRequestSchema = z
  .object({
    sessionId: IdentifierSchema,
    message: z.string().min(1).max(1_000_000),
    agentName: IdentifierSchema.optional(),
  })
  .strict();

chatRouter.post(
  "/",
  asyncHandler(async (req, res) => {
    const request = validateRequest(ChatRequestSchema, req.body, res);
    if (!request) return;
    const { sessionId, message, agentName } = request;

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();
    const controller = new AbortController();
    const abortOnDisconnect = () => {
      if (!res.writableEnded) controller.abort();
    };
    res.once("close", abortOnDisconnect);

    try {
      const runtime = sessionManager.getOrCreate(sessionId);
      const result = await runtime.deliver(message, agentName, controller.signal);
      const chunks = chunkSummary(result.summary);
      for (const chunk of chunks) {
        res.write(`data: ${JSON.stringify({ type: "text-delta", text: chunk })}\n\n`);
      }
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    } catch {
      console.error("[chat] Agent request failed");
      if (!res.destroyed) {
        res.write(`data: ${JSON.stringify({ type: "error", error: "Agent request failed" })}\n\n`);
      }
    } finally {
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
