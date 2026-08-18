import type { Server as HTTPServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createApp } from "./app.js";
import { parseServerConfig } from "./server-config.js";
import { initWebSocket } from "./ws/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env") });

export function createServer(app: express.Express): { server: HTTPServer; io: SocketIOServer } {
  const config = parseServerConfig();
  const server = app.listen(config.port, config.host);
  const io = new SocketIOServer(server, {
    cors: { origin: config.allowedOrigins },
  });

  io.on("connection", (socket) => {
    socket.on("disconnect", () => {});
  });

  initWebSocket(io);

  return { server, io };
}

const app: express.Express = createApp();
const { server } = createServer(app);

export { app, server };
