"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/lib/socket";

export function useSocket() {
  const socket = getSocket();
  const [connected, setConnected] = useState(socket.connected);

  useEffect(() => {
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (!socket.connected) socket.connect();
    return () => { socket.off("connect", onConnect); socket.off("disconnect", onDisconnect); };
  }, [socket]);

  return { socket, connected };
}
