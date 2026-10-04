"use client";

import { RefObject, useEffect, useLayoutEffect, useRef } from "react";
import {
  canHandleMediaSessionAction,
  createMediaPositionState,
  getMediaSeekTarget,
  getMediaSessionMetadata,
  type MediaPositionState,
  type MediaSeekAction,
} from "@/lib/mobile-media";
import type { VideoSource } from "@/types/realtime";

export interface MediaSessionActions {
  play: () => void | Promise<void>;
  pause: () => void;
  seekTo: (time: number) => void;
}

export function useMediaSession({
  canControl,
  roomName,
  source,
  actions,
  videoRef,
  position,
  isPlaying,
}: {
  canControl: boolean;
  roomName: string;
  source: VideoSource | null;
  actions: MediaSessionActions;
  videoRef?: RefObject<HTMLVideoElement | null>;
  position?: MediaPositionState | null;
  isPlaying?: boolean;
}) {
  const canControlRef = useRef(canControl);
  const actionsRef = useRef(actions);
  const positionRef = useRef(position);
  const isPlayingRef = useRef(isPlaying);
  useLayoutEffect(() => {
    canControlRef.current = canControl;
    actionsRef.current = actions;
    positionRef.current = position;
    isPlayingRef.current = isPlaying;
  }, [actions, canControl, isPlaying, position]);

  useEffect(() => {
    const mediaSession = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!mediaSession) return;

    const setPosition = () => {
      const video = videoRef?.current;
      const currentPosition = video
        ? createMediaPositionState(video.duration, video.currentTime, video.playbackRate)
        : positionRef.current
          ? createMediaPositionState(positionRef.current.duration, positionRef.current.position, positionRef.current.playbackRate)
          : null;
      if (currentPosition && typeof mediaSession.setPositionState === "function") {
        try { mediaSession.setPositionState(currentPosition); } catch { /* Browser rejected an unsupported position update. */ }
      }
      const playing = video ? !video.paused : isPlayingRef.current;
      if (playing !== undefined) mediaSession.playbackState = playing ? "playing" : "paused";
    };

    const register = (action: MediaSessionAction, handler: (details: MediaSessionActionDetails) => void) => {
      try {
        mediaSession.setActionHandler(action, handler);
        registeredActions.push(action);
      } catch { /* Some browsers expose Media Session but omit individual actions. */ }
    };
    const registeredActions: MediaSessionAction[] = [];
    register("play", () => {
      if (!canHandleMediaSessionAction(canControlRef.current)) return;
      void actionsRef.current.play();
    });
    register("pause", () => {
      if (!canHandleMediaSessionAction(canControlRef.current)) return;
      actionsRef.current.pause();
    });
    const seek = (action: MediaSeekAction) => (details: MediaSessionActionDetails) => {
      if (!canHandleMediaSessionAction(canControlRef.current)) return;
      const video = videoRef?.current;
      const currentPosition = video?.currentTime ?? positionRef.current?.position ?? 0;
      const duration = video?.duration ?? positionRef.current?.duration ?? Number.NaN;
      const target = getMediaSeekTarget(action, currentPosition, duration, details);
      if (target !== null) actionsRef.current.seekTo(target);
    };
    register("seekto", seek("seekto"));
    register("seekbackward", seek("seekbackward"));
    register("seekforward", seek("seekforward"));

    const video = videoRef?.current;
    const events = ["durationchange", "loadedmetadata", "play", "pause", "ratechange", "timeupdate"] as const;
    for (const event of events) video?.addEventListener(event, setPosition);
    setPosition();

    return () => {
      for (const event of events) video?.removeEventListener(event, setPosition);
      for (const action of registeredActions) {
        try { mediaSession.setActionHandler(action, null); } catch { /* Ignore unsupported action cleanup. */ }
      }
    };
  }, [videoRef, source]);

  useEffect(() => {
    const mediaSession = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!mediaSession) return;
    if (typeof MediaMetadata !== "undefined") {
      mediaSession.metadata = new MediaMetadata(getMediaSessionMetadata(source, roomName));
    }
  }, [roomName, source]);

  useEffect(() => {
    const mediaSession = typeof navigator === "undefined" ? undefined : navigator.mediaSession;
    if (!mediaSession) return;
    const validPosition = position
      ? createMediaPositionState(position.duration, position.position, position.playbackRate)
      : null;
    if (validPosition && typeof mediaSession.setPositionState === "function") {
      try { mediaSession.setPositionState(validPosition); } catch { /* Browser rejected an unsupported position update. */ }
    }
    if (isPlaying !== undefined) mediaSession.playbackState = isPlaying ? "playing" : "paused";
  }, [isPlaying, position]);
}
