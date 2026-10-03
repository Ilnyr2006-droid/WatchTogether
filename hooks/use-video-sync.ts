"use client";

import { RefObject, useCallback, useEffect, useRef } from "react";
import type { Socket } from "socket.io-client";
import { effectiveVideoTime, needsTimeCorrection } from "@/lib/video-sync";
import type { ClientToServerEvents, ServerToClientEvents, VideoState } from "@/types/realtime";

export function useVideoSync({ videoRef, isHost, canControl = true, socket, videoState }: {
  videoRef: RefObject<HTMLVideoElement | null>;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  canControl?: boolean;
  videoState: VideoState | null;
}) {
  const applyingRemote = useRef(false);
  const latestRevision = useRef(-1);
  const desiredPlaying = useRef<boolean | null>(null);
  const unlockTimer = useRef<number | undefined>(undefined);

  const applyState = useCallback(async (state: VideoState) => {
    const video = videoRef.current;
    if (!video) return;
    if (state.revision < latestRevision.current) return;
    latestRevision.current = state.revision;
    desiredPlaying.current = state.playing;
    applyingRemote.current = true;
    const target = effectiveVideoTime(state);
    try {
      if (needsTimeCorrection(video.currentTime, target) && Number.isFinite(target)) video.currentTime = target;
      if (state.playing && video.paused) await video.play();
      if (!state.playing && !video.paused) video.pause();
    } catch { /* Browser may require a user gesture; controls remain available. */ }
    if (unlockTimer.current) window.clearTimeout(unlockTimer.current);
    unlockTimer.current = window.setTimeout(() => { applyingRemote.current = false; }, 500);
  }, [videoRef]);

  useEffect(() => {
    if (videoState) void applyState(videoState);
  }, [applyState, videoState]);

  useEffect(() => () => { if (unlockTimer.current) window.clearTimeout(unlockTimer.current); }, []);

  const emit = useCallback((action: "play" | "pause" | "seek") => {
    const video = videoRef.current;
    if (!video || !canControl) return;
    if (action === "play" && desiredPlaying.current === true) return;
    if (action === "pause" && desiredPlaying.current === false) return;
    if (action === "seek" && applyingRemote.current && videoState && Math.abs(video.currentTime - effectiveVideoTime(videoState)) < 0.75) return;
    socket.emit("video:action", { action, currentTime: video.currentTime });
  }, [canControl, socket, videoRef, videoState]);

  useEffect(() => {
    if (!isHost || !canControl) return;
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (video && !video.paused) socket.emit("video:action", { action: "sync", currentTime: video.currentTime });
    }, 5000);
    return () => window.clearInterval(timer);
  }, [canControl, isHost, socket, videoRef]);

  return { onLoadedMetadata: () => { if (videoState) void applyState(videoState); }, onPlay: () => emit("play"), onPause: () => emit("pause"), onSeeked: () => emit("seek") };
}
