import { isRecord } from "@agent-harness/core";
import cors from "cors";
import type { NextFunction, Request, Response } from "express";
import express from "express";
import helmet from "helmet";
import { agentsRouter } from "./routes/agents.js";
import { chatRouter } from "./routes/chat.js";
import inboxRouter from "./routes/inbox.js";
import { pluginsRouter } from "./routes/plugins.js";
import { sessionsRouter } from "./routes/sessions.js";
import { settingsRouter } from "./routes/settings.js";
import { ttsRouter } from "./routes/tts.js";
import { workersRouter } from "./routes/workers.js";
import { parseServerConfig } from "./server-config.js";
import { sessionManager } from "./session-manager.js";

export function createApp(options?: {
  allowedOrigins?: readonly string[];
  jsonLimit?: string | number;
}) {
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
  app.use(express.json({ limit: options?.jsonLimit ?? "12mb" }));

  app.use("/api/sessions", sessionsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/inbox", inboxRouter);
  app.use("/api/workers", workersRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/tts", ttsRouter);
  app.use("/api/plugins", pluginsRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/metrics", (_req, res) => {
    res.json(sessionManager.metrics());
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
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
    console.error("[Server] Unhandled error:", err instanceof Error ? err.stack : err);
    res.status(500).json({
      error: { code: "internal_error", message: "Internal server error" },
    });
  });

  return app;
}
