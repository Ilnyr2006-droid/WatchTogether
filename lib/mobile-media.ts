import type { VideoSource } from "@/types/realtime";

export type MediaSeekAction = "seekto" | "seekbackward" | "seekforward";

export interface MediaPositionState {
  duration: number;
  position: number;
  playbackRate: number;
}

export function supportsPictureInPicture(
  documentLike: Pick<Document, "pictureInPictureEnabled"> | null | undefined,
  videoLike: Pick<HTMLVideoElement, "requestPictureInPicture"> | null | undefined,
) {
  return documentLike?.pictureInPictureEnabled === true && typeof videoLike?.requestPictureInPicture === "function";
}

export function canHandleMediaSessionAction(canControl: boolean) {
  return canControl;
}

export function getMediaSeekTarget(
  action: MediaSeekAction,
  currentTime: number,
  duration: number,
  details: { seekTime?: number; seekOffset?: number } = {},
): number | null {
  const base = Number.isFinite(currentTime) ? Math.max(0, currentTime) : 0;
  let target: number;

  if (action === "seekto") {
    if (!Number.isFinite(details.seekTime)) return null;
    target = details.seekTime!;
  } else {
    const offset = Number.isFinite(details.seekOffset) && details.seekOffset! > 0 ? details.seekOffset! : 10;
    target = action === "seekbackward" ? base - offset : base + offset;
  }

  return Number.isFinite(duration) && duration > 0
    ? Math.min(duration, Math.max(0, target))
    : Math.max(0, target);
}

export function createMediaPositionState(
  duration: number,
  position: number,
  playbackRate: number,
): MediaPositionState | null {
  if (!Number.isFinite(duration) || duration <= 0) return null;
  if (!Number.isFinite(position) || position < 0) return null;
  if (!Number.isFinite(playbackRate) || playbackRate <= 0) return null;
  return { duration, position: Math.min(duration, position), playbackRate };
}

export function getMediaSessionMetadata(source: VideoSource | null, roomName: string) {
  let title = "Видео";
  if (source?.provider === "rutube") {
    title = "Видео на RUTUBE";
  } else if (source?.provider === "html5") {
    if (source.mode === "url") {
      try {
        title = `Видео · ${new URL(source.url).hostname}`;
      } catch {
        title = "Видео по ссылке";
      }
    } else {
      const fileName = source.fileName.split(/[\\/]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 80);
      title = fileName || "Видео";
    }
  }

  return {
    title,
    artist: "WatchTogether",
    album: roomName ? `Комната ${roomName}` : "WatchTogether",
  };
}
