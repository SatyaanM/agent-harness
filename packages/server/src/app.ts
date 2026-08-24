import {
  createLogger,
  describeError,
  isRecord,
  MAX_INBOX_FILE_REQUEST_BYTES,
} from "@agent-harness/core";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import { agentsRouter } from "./routes/agents.js";
import { chatRouter } from "./routes/chat.js";
import inboxRouter from "./routes/inbox.js";
import { metricsRouter } from "./routes/metrics.js";
import { pluginsRouter } from "./routes/plugins.js";
import { sessionsRouter } from "./routes/sessions.js";
import { createSettingsRouter } from "./routes/settings.js";
import { ttsRouter } from "./routes/tts.js";
import { workersRouter } from "./routes/workers.js";
import { parseServerConfig } from "./server-config.js";

const logger = createLogger("server.app");

export function createApp(options?: {
  allowedOrigins?: readonly string[];
  jsonLimit?: string | number;
  inboxJsonLimit?: string | number;
}): express.Express {
  const app = express();
  const allowedOrigins = new Set(options?.allowedOrigins ?? parseServerConfig().allowedOrigins);

  app.use(helmet());
  app.use(
    cors({
      origin(origin, callback) {
        callback(null, origin === undefined || allowedOrigins.has(origin));
      },
    }),
  );
  app.use(
    "/api/inbox",
    express.json({ limit: options?.inboxJsonLimit ?? MAX_INBOX_FILE_REQUEST_BYTES }),
    inboxRouter,
  );
  app.use(express.json({ limit: options?.jsonLimit ?? "12mb" }));

  app.use("/api/sessions", sessionsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/workers", workersRouter);
  app.use("/api/settings", createSettingsRouter());
  app.use("/api/tts", ttsRouter);
  app.use("/api/plugins", pluginsRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use("/api/metrics", metricsRouter);

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) {
      // Headers are already flushed, so we cannot send a structured error
      // response. Express's default error handler will try to write one and
      // crash with ERR_HTTP_HEADERS_SENT. Log the error and ask the runtime
      // to drop the socket — the response is in an indeterminate state.
      logger.error("Unhandled error after response started", {
        ...describeError(err),
      });
      if (!res.writableEnded) {
        res.end();
      }
      return;
    }
    if (isRecord(err) && err.type === "entity.parse.failed") {
      res.status(400).json({
        error: { code: "invalid_json", message: "Request body contains malformed JSON" },
      });
      return;
    }
    if (isRecord(err) && err.type === "entity.too.large") {
      res.status(413).json({
        error: { code: "request_too_large", message: "Request body exceeds maximum size" },
      });
      return;
    }
    logger.error("Unhandled error", { ...describeError(err) });
    res.status(500).json({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });

  return app;
}
