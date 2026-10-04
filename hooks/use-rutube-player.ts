"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { effectiveVideoTime, isNewerVideoRevision, needsTimeCorrection, shouldResyncOnControlLoss } from "@/lib/video-sync";
import { classifyRutubePlayerError, type RutubePlayerStatus } from "@/lib/rutube-player-state";
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

export function useRutubePlayer({ iframeRef, socket, isHost, canControl, video }: {
  iframeRef: RefObject<HTMLIFrameElement | null>;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  canControl: boolean;
  video: VideoState;
}) {
  const [status, setStatus] = useState<RutubePlayerStatus>("loading");
  const [advertising, setAdvertising] = useState(false);
  const [duration, setDuration] = useState<number | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(video.playing);
  const readyRef = useRef(false);
  const advertisingRef = useRef(false);
  const currentTimeRef = useRef(0);
  const playingRef = useRef(video.playing);
  const latestVideoRef = useRef(video);
  const latestAppliedRevision = useRef(-1);
  const previousCanControl = useRef(canControl);
  const suppressUntilRef = useRef(0);
  const lastSampleRef = useRef<{ time: number; at: number } | null>(null);
  const lastSeekEmitRef = useRef(0);
  const lastStateEmitRef = useRef<"playing" | "paused" | null>(null);

  useEffect(() => {
    if (video.revision >= latestVideoRef.current.revision) {
      latestVideoRef.current = video;
      playingRef.current = video.playing;
      setIsPlaying(video.playing);
    }
  }, [video]);

  const command = useCallback((payload: RutubeCommand) => {
    if (!readyRef.current || !iframeRef.current?.contentWindow) return false;
    iframeRef.current.contentWindow.postMessage(JSON.stringify(payload), RUTUBE_ORIGIN);
    return true;
  }, [iframeRef]);

  const applyRemoteState = useCallback((state: VideoState, force = false) => {
    if (!readyRef.current || advertisingRef.current) return;
    if (state.revision < latestAppliedRevision.current || (!force && !isNewerVideoRevision(latestAppliedRevision.current, state.revision))) return;
    latestAppliedRevision.current = state.revision;
    suppressUntilRef.current = Date.now() + 1_500;
    playingRef.current = state.playing;
    setIsPlaying(state.playing);
    lastStateEmitRef.current = state.playing ? "playing" : "paused";
    const target = effectiveVideoTime(state);
    if (force || needsTimeCorrection(currentTimeRef.current, target)) {
      command({ type: "player:setCurrentTime", data: { time: Math.max(0, target) } });
      currentTimeRef.current = target;
    }
    command({ type: state.playing ? "player:play" : "player:pause", data: {} });
  }, [command]);

  useEffect(() => { applyRemoteState(video); }, [applyRemoteState, video]);

  useEffect(() => {
    const lostControl = shouldResyncOnControlLoss(previousCanControl.current, canControl);
    previousCanControl.current = canControl;
    if (lostControl) applyRemoteState(video, true);
  }, [applyRemoteState, canControl, video]);

  useEffect(() => {
    if (status === "ready") command({ type: "player:showControls", data: {} });
  }, [command, status]);

  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      if (event.origin !== RUTUBE_ORIGIN || event.source !== iframeRef.current?.contentWindow) return;
      const message = readMessage(event.data);
      if (!message) return;

      if (message.type === "player:ready") {
        readyRef.current = true; setStatus("ready");
        command({ type: "player:showControls", data: {} });
        applyRemoteState(latestVideoRef.current, true);
        return;
      }
      if (message.type === "player:error") {
        if (message.data?.fatal === false) return;
        readyRef.current = false; advertisingRef.current = false; setAdvertising(false);
        setStatus(classifyRutubePlayerError(message.data));
        return;
      }
      if (message.type === "player:durationChange") {
        const value = Number(message.data?.duration);
        if (Number.isFinite(value) && value > 0) setDuration(value);
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
        setCurrentTime(time);
        if (!advertisingRef.current && now >= suppressUntilRef.current && previous) {
          const expected = previous.time + (playingRef.current ? (now - previous.at) / 1000 : 0);
          if (Math.abs(time - expected) > 1.1 && now - lastSeekEmitRef.current > 700) {
            lastSeekEmitRef.current = now;
            if (canControl) socket.emit("video:action", { action: "seek", currentTime: time });
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
        setIsPlaying(playingRef.current);
        if (canControl && !advertisingRef.current && Date.now() >= suppressUntilRef.current && lastStateEmitRef.current !== normalized) {
          lastStateEmitRef.current = normalized;
          socket.emit("video:action", { action: normalized === "playing" ? "play" : "pause", currentTime: currentTimeRef.current });
        }
      }
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [applyRemoteState, canControl, command, iframeRef, socket]);

  useEffect(() => {
    if (!isHost || !canControl) return;
    const timer = window.setInterval(() => {
      if (readyRef.current && playingRef.current && !advertisingRef.current) socket.emit("video:action", { action: "sync", currentTime: currentTimeRef.current });
    }, 5_000);
    return () => window.clearInterval(timer);
  }, [canControl, isHost, socket]);

  const changeVideo = useCallback((nextVideoId: string) => command({ type: "player:changeVideo", data: { id: nextVideoId } }), [command]);
  const mediaActions = {
    play: () => {
      if (canControl && readyRef.current && !playingRef.current) command({ type: "player:play", data: {} });
    },
    pause: () => {
      if (canControl && readyRef.current && playingRef.current) command({ type: "player:pause", data: {} });
    },
    seekTo: (time: number) => {
      if (!canControl || !readyRef.current || !Number.isFinite(time) || time < 0) return;
      const target = duration ? Math.min(duration, time) : time;
      const now = Date.now();
      currentTimeRef.current = target;
      setCurrentTime(target);
      lastSampleRef.current = { time: target, at: now };
      lastSeekEmitRef.current = now;
      suppressUntilRef.current = now + 1_500;
      command({ type: "player:setCurrentTime", data: { time: target } });
      socket.emit("video:action", { action: "seek", currentTime: target });
    },
  };
  return { status, ready: status === "ready", advertising, duration, currentTime, isPlaying, command, changeVideo, mediaActions };
}
