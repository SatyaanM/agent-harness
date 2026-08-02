import { Router } from "express";
import { sessionManager } from "../session-manager.js";

export const chatRouter = Router();

chatRouter.post("/", async (req, res) => {
  const { sessionId, message, agentName } = req.body as {
    sessionId?: string;
    message?: string;
    agentName?: string;
  };

  console.log("[chat] Request:", { sessionId, messageLength: message?.length, agentName });

  if (!sessionId || !message) {
    res.status(400).json({ error: "sessionId and message are required" });
    return;
  }

  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders();

  try {
    const runtime = sessionManager.getOrCreate(sessionId);
    const result = await runtime.deliver(message, agentName);
    console.log("[chat] Agent completed:", { status: result.status, summaryLength: result.summary?.length });

    const chunks = result.summary.match(/.{1,40}(\s|$)/gs) ?? [result.summary];
    for (const chunk of chunks) {
      res.write(`data: ${JSON.stringify({ type: "text-delta", text: chunk })}\n\n`);
    }
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
  } catch (error) {
    console.error("[chat] Error:", error);
    const errorMessage = error instanceof Error ? error.message : String(error);
    res.write(`data: ${JSON.stringify({ type: "error", error: errorMessage })}\n\n`);
  }

  res.end();
});
