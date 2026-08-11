"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { effectiveVideoTime, needsTimeCorrection } from "@/lib/video-sync";
import type { ClientToServerEvents, ServerToClientEvents, VideoState } from "@/types/realtime";

const RUTUBE_ORIGIN = "https://rutube.ru";
type RutubeCommand =
  | { type: "player:play" | "player:pause" | "player:showControls" | "player:hideControls"; data?: Record<string, never> }
  | { type: "player:setCurrentTime"; data: { time: number } }
  | { type: "player:changeVideo"; data: { id: string } };

interface RutubeMessage { type: string; data?: Record<string, unknown> }

function readMessage(value: unknown): RutubeMessage | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object" || typeof (parsed as RutubeMessage).type !== "string") return null;
    return parsed as RutubeMessage;
  } catch { return null; }
}

export function useRutubePlayer({ iframeRef, socket, isHost, video }: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  video: VideoState;
}) {
  const [ready, setReady] = useState(false);
  const [advertising, setAdvertising] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [error, setError] = useState("");
  const readyRef = useRef(false);
  const advertisingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const playingRef = useRef(video.playing);
  const latestVideoRef = useRef(video);
  const suppressUntilRef = useRef(0);
  const lastSampleRef = useRef<{ time: number; at: number } | null>(null);
  const lastSeekEmitRef = useRef(0);
  const lastStateEmitRef = useRef<"playing" | "paused" | null>(null);

  useEffect(() => { latestVideoRef.current = video; playingRef.current = video.playing; }, [video]);

  const command = useCallback((payload: RutubeCommand) => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return false;
    iframeRef.current.contentWindow.postMessage(JSON.stringify(payload), RUTUBE_ORIGIN);
    return true;
  }, [iframeRef]);

  const applyRemoteState = useCallback((state: VideoState, force = false) => {
    if (!readyRef.current || advertisingRef.current) return;
    suppressUntilRef.current = Date.now() + 1_500;
    const target = effectiveVideoTime(state);
    if (force || needsTimeCorrection(currentTimeRef.current, target)) {
      command({ type: "player:setCurrentTime", data: { time: Math.max(0, target) } });
      currentTimeRef.current = target;
    }
    command({ type: state.playing ? "player:play" : "player:pause", data: {} });
  }, [command]);

  useEffect(() => { applyRemoteState(video); }, [applyRemoteState, video]);

  useEffect(() => {
    if (ready) command({ type: isHost ? "player:showControls" : "player:hideControls", data: {} });
  }, [command, isHost, ready]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== RUTUBE_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;
      const message = readMessage(event.data);
      if (!message) return;

      if (message.type === "player:ready") {
        readyRef.current = true; setReady(true); setError("");
        command({ type: isHost ? "player:showControls" : "player:hideControls", data: {} });
        applyRemoteState(latestVideoRef.current, true);
        return;
      }
      if (message.type === "player:error") { setError("RUTUBE не смог загрузить видео"); return; }
      if (message.type === "player:durationChange") {
        const value = Number(message.data?.duration);
        if (Number.isFinite(value) && value >= 0) setDuration(value);
        return;
      }
      if (message.type === "player:adStart" || (message.type === "player:rollState" && message.data?.state === "play")) {
        advertisingRef.current = true; setAdvertising(true); return;
      }
      if (message.type === "player:adEnd" || (message.type === "player:rollState" && message.data?.state === "complete")) {
        advertisingRef.current = false; setAdvertising(false);
        window.setTimeout(() => applyRemoteState(latestVideoRef.current, true), 400);
        return;
      }
      if (message.type === "player:currentTime") {
        const time = Number(message.data?.time);
        if (!Number.isFinite(time) || time < 0) return;
        const now = Date.now();
        const previous = lastSampleRef.current;
        currentTimeRef.current = time;
        if (isHost && !advertisingRef.current && now >= suppressUntilRef.current && previous) {
          const expected = previous.time + (playingRef.current ? (now - previous.at) / 1000 : 0);
          if (Math.abs(time - expected) > 1.1 && now - lastSeekEmitRef.current > 700) {
            lastSeekEmitRef.current = now;
            socket.emit("video:action", { action: "seek", currentTime: time });
          }
        }
        lastSampleRef.current = { time, at: now };
        return;
      }
      if (message.type === "player:changeState") {
        const state = message.data?.state;
        if (state !== "playing" && state !== "pause" && state !== "paused" && state !== "stopped") return;
        const normalized = state === "playing" ? "playing" : "paused";
        playingRef.current = normalized === "playing";
        if (isHost && !advertisingRef.current && Date.now() >= suppressUntilRef.current && lastStateEmitRef.current !== normalized) {
          lastStateEmitRef.current = normalized;
          socket.emit("video:action", { action: normalized === "playing" ? "play" : "pause", currentTime: currentTimeRef.current });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyRemoteState, command, iframeRef, isHost, socket]);

  useEffect(() => {
    if (!isHost) return;
    const timer = window.setInterval(() => {
      if (readyRef.current && playingRef.current && !advertisingRef.current) socket.emit("video:action", { action: "sync", currentTime: currentTimeRef.current });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [isHost, socket]);

  const changeVideo = useCallback((nextVideoId: string) => command({ type: "player:changeVideo", data: { id: nextVideoId } }), [command]);
  return { ready, advertising, duration, error, command, changeVideo };
}
