"use client";

import { io, type Socket } from "socket.io-client";
import type { ClientToServerEvents, ServerToClientEvents } from "@/types/realtime";

let instance: Socket<ServerToClientEvents, ClientToServerEvents> | null = null;

export function getSocket() {
  if (!instance) instance = io({ autoConnect: false, transports: ["websocket", "polling"] });
  return instance;
}
