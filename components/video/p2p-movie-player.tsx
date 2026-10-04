"use client";

import { useEffect, useRef, useState } from "react";
import { Expand, PictureInPicture2, Volume2, VolumeX } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useP2PMovie } from "@/hooks/use-p2p-movie";
import { useVideoSync } from "@/hooks/use-video-sync";
import { usePictureInPicture } from "@/hooks/use-picture-in-picture";
import type {
  ClientToServerEvents,
  Participant,
  ServerToClientEvents,
  VideoState,
} from "@/types/realtime";

export function P2PMoviePlayer({
  socket,
  isHost,
  canControl,
  hostId,
  participants,
  roomId,
  video,
  file,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  canControl: boolean;
  hostId: string;
  participants: Participant[];
  roomId: string;
  video: VideoState;
  file: File | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [muted, setMuted] = useState(false);
  const source =
    video.source?.provider === "html5" && video.source.mode === "p2p-movie"
      ? video.source
      : null;
  if (!source) throw new Error("P2P movie source is missing");
  const p2p = useP2PMovie({
    socket,
    isHost,
    hostId,
    participants,
    source,
    file,
    videoRef,
  });
  const sync = useVideoSync({ videoRef, socket, isHost, canControl, videoState: video, roomName: roomId });
  const pip = usePictureInPicture(videoRef, video.source);

  useEffect(() => {
    if (!isHost || !file || !videoRef.current) return;
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isHost, source.sourceId]);

  const stateText =
    p2p.state === "connecting"
      ? "Подключаем фильм…"
      : p2p.state === "buffering"
        ? "Буферизация…"
        : p2p.state === "ready"
          ? "Готово"
          : "Не удалось подключиться";
  return (
    <div className="relative bg-black">
      <div className="relative aspect-video">
        <video
          data-testid="shared-video"
          ref={videoRef}
          controls={canControl}
          playsInline
          preload="metadata"
          className="h-full w-full"
          onLoadedMetadata={sync.onLoadedMetadata}
          onPlay={sync.onPlay}
          onPause={sync.onPause}
          onSeeked={sync.onSeeked}
          onVolumeChange={() => setMuted(videoRef.current?.muted ?? false)}
        />
        {isHost && !file && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/90 px-6 text-center text-slate-300">
            Повторно выберите исходный файл на компьютере, где запущена комната.
          </div>
        )}
        {!isHost && p2p.state !== "ready" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950/75">
            <div className="text-center">
              <p className="font-medium text-white">{p2p.error ? "Не удалось подключить фильм" : "Подключаем участников к просмотру…"}</p>
            </div>
          </div>
        )}
        <div className="absolute right-2 top-2 flex gap-2">
          <button type="button" onClick={() => { const node = videoRef.current; if (node) node.muted = !node.muted; }} className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg bg-black/70 p-2 text-white" aria-label={muted ? "Включить звук" : "Выключить звук"} title={muted ? "Включить звук" : "Выключить звук"}>{muted ? <VolumeX className="size-5" /> : <Volume2 className="size-5" />}</button>
          {pip.supported && <button type="button" onClick={() => void pip.toggle()} className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg bg-black/70 p-2 text-white" aria-label={pip.active ? "Выйти из PiP" : "Картинка в картинке"} title={pip.active ? "Выйти из PiP" : "Картинка в картинке"}><PictureInPicture2 className="size-5" /></button>}
          <button type="button" onClick={() => { const node = videoRef.current; if (node?.requestFullscreen) void node.requestFullscreen().catch(() => {}); }} className="flex min-h-11 min-w-11 touch-manipulation items-center justify-center rounded-lg bg-black/70 p-2 text-white" aria-label="Полный экран" title="Полный экран"><Expand className="size-5" /></button>
        </div>
      </div>
      <details className="border-t border-white/10 px-4 py-2 text-xs text-slate-400">
        <summary className="min-h-9 cursor-pointer py-2">Сведения о воспроизведении</summary>
        <div className="grid grid-cols-2 gap-2 pb-2 sm:grid-cols-5">
          <span>Состояние: <b data-testid="p2p-state" data-state={p2p.state}>{stateText}</b></span>
          <span>Буфер: <b>{p2p.bufferSeconds.toFixed(0)} сек.</b></span>
          <span>Скорость: <b>{p2p.speedMbps.toFixed(1)} Mbps</b></span>
          <span>Передано: <b data-testid="p2p-transferred-bytes" data-bytes={p2p.transferredBytes}>{(p2p.transferredBytes / 1024 / 1024).toFixed(1)} MB</b></span>
          <span>Соединение: <b>{p2p.route}</b></span>
        </div>
      </details>
      {p2p.error && (
        <div className="border-t border-red-500/20 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {p2p.error}
        </div>
      )}
    </div>
  );
}
