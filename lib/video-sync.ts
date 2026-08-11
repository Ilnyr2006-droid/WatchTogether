import type { VideoState } from "@/types/realtime";

export const SYNC_THRESHOLD_SECONDS = 0.75;

export function effectiveVideoTime(video: VideoState, now = Date.now()): number {
  if (!video.playing) return video.currentTime;
  return video.currentTime + Math.max(0, now - video.updatedAt) / 1000;
}

export function needsTimeCorrection(localTime: number, remoteTime: number, threshold = SYNC_THRESHOLD_SECONDS) {
  return Math.abs(localTime - remoteTime) > threshold;
}
