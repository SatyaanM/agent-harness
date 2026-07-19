import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Server as HTTPServer } from "node:http";
import express from "express";
import type { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import { Server as SocketIOServer } from "socket.io";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env") });
import { sessionsRouter } from "./routes/sessions.js";
import { chatRouter } from "./routes/chat.js";
import { agentsRouter } from "./routes/agents.js";
import inboxRouter from "./routes/inbox.js";
import { settingsRouter } from "./routes/settings.js";
import { ttsRouter } from "./routes/tts.js";
import { initWebSocket } from "./ws/events.js";

export function createApp() {
  const app = express();

  app.use(helmet());
  app.use(cors());
  app.use(express.json());

  app.use("/api/sessions", sessionsRouter);
  app.use("/api/chat", chatRouter);
  app.use("/api/agents", agentsRouter);
  app.use("/api/inbox", inboxRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/tts", ttsRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error("[Server] Unhandled error:", err.stack ?? err.message);
    res.status(500).json({ error: err.message || "Internal server error" });
  });

  return app;
}

export function createServer(app: express.Express): { server: HTTPServer; io: SocketIOServer } {
  const server = app.listen(Number(process.env["PORT"] ?? 3001));
  const io = new SocketIOServer(server, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {});
  });

  initWebSocket(io);

  return { server, io };
}

const app = createApp();
const { server } = createServer(app);

export { app, server };
