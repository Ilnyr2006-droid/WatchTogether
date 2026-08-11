"use client";

import { RefObject, useCallback, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { effectiveVideoTime, needsTimeCorrection } from "@/lib/video-sync";
import type { ClientToServerEvents, ServerToClientEvents, VideoState } from "@/types/realtime";

export function useVideoSync({ videoRef, socket, isHost, videoState }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  videoState: VideoState | null;
}) {
  const applyingRemote = useRef(false);

  const applyState = useCallback(async (state: VideoState) => {
    const video = videoRef.current;
    if (!video) return;
    applyingRemote.current = true;
    const target = effectiveVideoTime(state);
    try {
      if (needsTimeCorrection(video.currentTime, target) && Number.isFinite(target)) video.currentTime = target;
      if (state.playing && video.paused) await video.play();
      if (!state.playing && !video.paused) video.pause();
    } catch { /* Browser may require a user gesture; controls remain available. */ }
    window.setTimeout(() => { applyingRemote.current = false; }, 100);
  }, [videoRef]);

  useEffect(() => {
    if (videoState) void applyState(videoState);
  }, [applyState, videoState]);

  const emit = useCallback((action: "play" | "pause" | "seek") => {
    const video = videoRef.current;
    if (!isHost || !video || applyingRemote.current) return;
    socket.emit("video:action", { action, currentTime: video.currentTime });
  }, [isHost, socket, videoRef]);

  useEffect(() => {
    if (!isHost) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused) socket.emit("video:action", { action: "sync", currentTime: video.currentTime });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [isHost, socket, videoRef]);

  return { onLoadedMetadata: () => { if (videoState) void applyState(videoState); }, onPlay: () => emit("play"), onPause: () => emit("pause"), onSeeked: () => emit("seek") };
}
