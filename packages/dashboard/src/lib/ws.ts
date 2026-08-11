"use client";

import { io, type Socket } from "socket.io-client";

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";

let socket: Socket | null = null;

export function connectSocket(): Socket {
  if (!socket) {
    socket = io(BASE_URL, { transports: ["websocket"] });
  }
  return socket;
}
