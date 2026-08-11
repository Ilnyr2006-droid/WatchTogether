"use client";

import { useCallback, useRef, useState } from "react";
import { Expand, PlaySquare } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useVideoSync } from "@/hooks/use-video-sync";
import type { ClientToServerEvents, ServerToClientEvents, VideoState } from "@/types/realtime";

export function Html5Player({ socket, isHost, video, localUrl, localFileName, roomId, streamToken }: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  video: VideoState;
  localUrl: string | null;
  localFileName: string | null;
  roomId: string;
  streamToken: string;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playbackError, setPlaybackError] = useState(false);
  const handlers = useVideoSync({ videoRef, socket, isHost, videoState: video });
  const source = video.source?.provider === "html5"
    ? video.source.mode === "url"
      ? video.source.url
      : video.source.mode === "local"
        ? localFileName === video.source.fileName ? localUrl ?? undefined : undefined
        : video.source.mode === "host-stream" && streamToken ? `/api/rooms/${encodeURIComponent(roomId)}/stream?token=${encodeURIComponent(streamToken)}&v=${encodeURIComponent(video.source.streamId)}` : undefined
    : undefined;
  const fullscreen = useCallback(() => { void videoRef.current?.requestFullscreen(); }, []);
  const localName = video.source?.provider === "html5" && video.source.mode === "local" ? video.source.fileName : null;
  const hostStreamName = video.source?.provider === "html5" && video.source.mode === "host-stream" ? video.source.fileName : null;

  return <div className="relative aspect-video bg-black">
    {source ? <video ref={videoRef} key={source} src={source} controls={isHost || Boolean(hostStreamName)} playsInline preload="metadata" className="h-full w-full" onLoadStart={() => setPlaybackError(false)} onError={() => setPlaybackError(true)} onLoadedMetadata={() => { setPlaybackError(false); handlers.onLoadedMetadata(); }} onPlay={handlers.onPlay} onPause={handlers.onPause} onSeeked={handlers.onSeeked} /> : <div className="grid h-full place-items-center px-6 text-center"><div><PlaySquare className="mx-auto size-14 text-violet-400" /><p className="mt-4 font-medium text-slate-300">{localName ? `Выберите локальный файл «${localName}»` : hostStreamName ? `Подключаем фильм «${hostStreamName}»…` : isHost ? "Выберите видео, чтобы начать просмотр" : "Host ещё не выбрал видео"}</p><p className="mt-2 text-sm text-slate-500">{hostStreamName ? "Фильм передаётся с локального сервера Host" : "Локальный файл не загружается на сервер"}</p></div></div>}
    {playbackError && <div className="absolute inset-x-4 bottom-4 rounded-xl bg-red-950/90 px-4 py-3 text-center text-sm text-red-200">Этот формат нельзя воспроизвести напрямую в браузере. Требуется конвертация.</div>}
    {source && <button onClick={fullscreen} className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-white hover:bg-black/80" title="Полный экран"><Expand className="size-5" /></button>}
  </div>;
}
