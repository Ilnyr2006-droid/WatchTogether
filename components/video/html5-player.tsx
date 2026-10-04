"use client";

import { useCallback, useRef, useState } from "react";
import { Expand, PictureInPicture2, PlaySquare, Volume2, VolumeX } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useVideoSync } from "@/hooks/use-video-sync";
import { usePictureInPicture } from "@/hooks/use-picture-in-picture";
import type { ClientToServerEvents, ServerToClientEvents, VideoState } from "@/types/realtime";

export function Html5Player({ socket, isHost, canControl, video, localUrl, localFileName, roomId, streamToken, currentPlaylistItemId, currentPlaylistPlaybackId, onDurationChange }: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  canControl: boolean;
  video: VideoState;
  localUrl: string | null;
  localFileName: string | null;
  roomId: string;
  streamToken: string;
  currentPlaylistItemId: string | null;
  currentPlaylistPlaybackId: string | null;
  onDurationChange?: (duration: number) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const [muted, setMuted] = useState(false);
  const handlers = useVideoSync({ videoRef, socket, isHost, canControl, videoState: video, roomName: roomId });
  const pip = usePictureInPicture(videoRef, video.source);
  const source = video.source?.provider === "html5"
    ? video.source.mode === "url"
      ? video.source.url
      : video.source.mode === "local"
        ? localFileName === video.source.fileName ? localUrl ?? undefined : undefined
        : video.source.mode === "host-stream" && streamToken ? video.source.mediaId
          ? `/api/rooms/${encodeURIComponent(roomId)}/media/${encodeURIComponent(video.source.mediaId)}/stream?token=${encodeURIComponent(streamToken)}`
          : `/api/rooms/${encodeURIComponent(roomId)}/stream?token=${encodeURIComponent(streamToken)}&v=${encodeURIComponent(video.source.streamId)}` : undefined
    : undefined;
  const fullscreen = useCallback(() => {
    const videoElement = videoRef.current;
    if (videoElement?.requestFullscreen) void videoElement.requestFullscreen().catch(() => {});
  }, []);
  const toggleMute = useCallback(() => {
    const videoElement = videoRef.current;
    if (videoElement) videoElement.muted = !videoElement.muted;
  }, []);
  const localName = video.source?.provider === "html5" && video.source.mode === "local" ? video.source.fileName : null;
  const hostStreamName = video.source?.provider === "html5" && video.source.mode === "host-stream" ? video.source.fileName : null;

  return <div className="relative aspect-video bg-black">
    {source ? <video data-testid="shared-video" ref={videoRef} key={source} src={source} controls={canControl} playsInline preload="auto" className="h-full w-full" onLoadStart={() => setPlaybackError(false)} onError={() => { setPlaybackError(true); if (video.source?.provider === "html5" && video.source.mode === "host-stream" && video.source.mediaId) socket.emit("participant:update", { ready: false }); }} onLoadedMetadata={() => { setPlaybackError(false); handlers.onLoadedMetadata(); const duration = videoRef.current?.duration; if (duration && Number.isFinite(duration)) onDurationChange?.(duration); }} onLoadedData={() => { if (video.source?.provider === "html5" && video.source.mode === "host-stream" && video.source.mediaId) socket.emit("participant:update", { ready: true }); }} onPlay={handlers.onPlay} onPause={handlers.onPause} onSeeked={handlers.onSeeked} onEnded={() => { if (isHost && currentPlaylistItemId && currentPlaylistPlaybackId) socket.emit("playlist:ended", { itemId: currentPlaylistItemId, playbackId: currentPlaylistPlaybackId }); }} onVolumeChange={() => setMuted(videoRef.current?.muted ?? false)} /> : <div className="grid h-full place-items-center px-6 text-center"><div><PlaySquare className="mx-auto size-14 text-white/75" /><p className="mt-4 font-medium text-slate-200">{localName ? `Выберите локальный файл «${localName}»` : hostStreamName ? `Подключаем фильм «${hostStreamName}»…` : isHost ? "Ничего не воспроизводится" : "Host ещё не выбрал фильм"}</p><p className="mt-2 text-sm text-slate-400">{hostStreamName ? "Фильм загружается с компьютера владельца комнаты" : isHost ? "Нажмите «Добавить», чтобы выбрать источник" : ""}</p></div></div>}
    {playbackError && <div className="absolute inset-x-4 bottom-4 rounded-xl bg-red-950/90 px-4 py-3 text-center text-sm text-red-200">Этот формат браузер не может воспроизвести напрямую.</div>}
    {source && <div className="absolute right-2 top-2 flex gap-2">
      <button type="button" onClick={toggleMute} className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg bg-black/70 p-2 text-white hover:bg-black/90" aria-label={muted ? "Включить звук" : "Выключить звук"} title={muted ? "Включить звук" : "Выключить звук"}>{muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}</button>
      {pip.supported && <button type="button" onClick={() => void pip.toggle()} className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg bg-black/70 p-2 text-white hover:bg-black/90" aria-label={pip.active ? "Выйти из PiP" : "Картинка в картинке"} title={pip.active ? "Выйти из PiP" : "Картинка в картинке"}><PictureInPicture2 className="size-5" /></button>}
      <button type="button" onClick={fullscreen} className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg bg-black/70 p-2 text-white hover:bg-black/90" aria-label="Полный экран" title="Полный экран"><Expand className="size-5" /></button>
    </div>}
  </div>;
}
