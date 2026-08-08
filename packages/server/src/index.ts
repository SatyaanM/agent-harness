import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import type { Server as HTTPServer } from "node:http";
import express from "express";
import { Server as SocketIOServer } from "socket.io";
import { createApp } from "./app.js";
import { initWebSocket } from "./ws/events.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "../../..");
dotenv.config({ path: path.join(rootDir, ".env") });

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
