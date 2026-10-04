"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";

export function useSocket() {
  const socket = getSocket();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    if (document.documentElement.dataset.watchtogetherE2e === "true")
      (window as Window & { __watchTogetherSocket?: typeof socket }).__watchTogetherSocket = socket;
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (!socket.connected) socket.connect();
    return () => { socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); };
  }, [socket]);

  return { socket, connected };
}
