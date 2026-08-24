import { randomUUID } from "node:crypto";
import {
  ChatStreamEventSchema,
  createLogger,
  describeError,
  getTracer,
  SpanKind,
  SpanStatusCode,
  W3CTraceContext,
} from "@agent-harness/core";

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
      writeChatEvent(res, { type: "error", error: "Session is no longer available" });
      res.end();
      return;
    }

    sessionManager.trackSession(sessionId, controller);
    const requestId = randomUUID();
    const tracer = getTracer();
    const parentContext = W3CTraceContext.extract(req.headers);
    const serverSpan = tracer.startSpan(
      "HTTP POST /api/chat",
      {
        kind: SpanKind.SERVER,
        attributes: {
          "http.method": "POST",
          "http.route": "/api/chat",
          "agent.session_id": sessionId,
          "agent.request_id": requestId,
          "agent.name": agentName,
          "agent.is_retry": Boolean(retry),
        },
      },
      parentContext,
    );

    try {
      await tracer.withSpan(serverSpan, async () => {
        const runtime = sessionManager.getOrCreate(sessionId);
        let streamed = false;
        const handleEvent = (event: import("@agent-harness/core").SessionRuntimeEvent) => {
          if ("requestId" in event && event.requestId === requestId) {
            if (event.type === "agent:text-delta") {
              streamed = true;
              writeChatEvent(res, { type: "text-delta", text: event.text });
            } else if (event.type === "agent:tool-call-delta") {
              writeChatEvent(res, { type: "tool-call-delta", toolCall: event.toolCall });
            }
          }
        };
        runtime.on(handleEvent);
        try {
          const result = retry
            ? await runtime.retry(message, agentName, controller.signal, requestId)
            : await runtime.deliver(message, agentName, controller.signal, requestId);
          if (!streamed && result.summary) {
            for (const chunk of chunkSummary(result.summary)) {
              writeChatEvent(res, { type: "text-delta", text: chunk });
            }
          }
          writeChatEvent(res, { type: "done" });
          serverSpan.setStatus({
            code: result.status === "success" ? SpanStatusCode.OK : SpanStatusCode.ERROR,
          });
        } finally {
          runtime.off(handleEvent);
        }
      });
    } catch (error) {
      serverSpan.recordException(error);
      logger.error("Agent request failed", {
        requestId,
        sessionId,
        ...describeError(error),
      });
      if (!res.destroyed) {
        writeChatEvent(res, { type: "error", error: "Agent request failed" });
      }
    } finally {
      serverSpan.end();
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

function writeChatEvent(
  response: import("express").Response,
  event: import("@agent-harness/core").ChatStreamEvent,
): void {
  const validated = ChatStreamEventSchema.parse(event);
  response.write(`data: ${JSON.stringify(validated)}\n\n`);
}
