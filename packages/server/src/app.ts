import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { sessionsRouter } from "./routes/sessions.js";
import { chatRouter } from "./routes/chat.js";
import { agentsRouter } from "./routes/agents.js";
import inboxRouter from "./routes/inbox.js";
import { workersRouter } from "./routes/workers.js";
import { settingsRouter } from "./routes/settings.js";
import { ttsRouter } from "./routes/tts.js";
import { pluginsRouter } from "./routes/plugins.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

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

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server] Unhandled error:", err.stack ?? err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  return app;
}
