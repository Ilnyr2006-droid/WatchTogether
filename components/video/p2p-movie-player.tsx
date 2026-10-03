"use client";

import { useEffect, useRef } from "react";
import { Expand } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useP2PMovie } from "@/hooks/use-p2p-movie";
import { useVideoSync } from "@/hooks/use-video-sync";
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
  video,
  file,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  canControl: boolean;
  hostId: string;
  participants: Participant[];
  video: VideoState;
  file: File | null;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const sync = useVideoSync({ videoRef, socket, isHost, canControl, videoState: video });

  useEffect(() => {
    if (!isHost || !file || !videoRef.current) return;
    const url = URL.createObjectURL(file);
    videoRef.current.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, isHost, source.sourceId]);

  const stateText =
    p2p.state === "connecting"
      ? "Подключение P2P…"
      : p2p.state === "buffering"
        ? "Буферизация…"
        : p2p.state === "ready"
          ? "Готово"
          : "Ошибка P2P";
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
        />
        {isHost && !file && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/90 px-6 text-center text-slate-300">
            Повторно выберите исходный файл на этом Host.
          </div>
        )}
        {!isHost && p2p.state !== "ready" && (
          <div className="pointer-events-none absolute inset-0 grid place-items-center bg-slate-950/75">
            <div className="text-center">
              <p className="font-medium text-white">{stateText}</p>
              <p className="mt-2 text-sm text-slate-400">
                Буфер: {p2p.bufferSeconds.toFixed(0)} сек.
              </p>
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => void videoRef.current?.requestFullscreen()}
          className="absolute right-3 top-3 rounded-lg bg-black/60 p-2 text-white"
          title="Полный экран"
        >
          <Expand className="size-5" />
        </button>
      </div>
      <div className="grid grid-cols-2 gap-2 border-t border-white/10 bg-slate-950/80 px-4 py-3 text-xs text-slate-300 sm:grid-cols-5">
        <span>
          Состояние: <b data-testid="p2p-state" data-state={p2p.state}>{stateText}</b>
        </span>
        <span>
          Буфер: <b>{p2p.bufferSeconds.toFixed(0)} сек.</b>
        </span>
        <span>
          Скорость: <b>{p2p.speedMbps.toFixed(1)} Mbps</b>
        </span>
        <span>
          Передано: <b data-testid="p2p-transferred-bytes" data-bytes={p2p.transferredBytes}>{(p2p.transferredBytes / 1024 / 1024).toFixed(1)} MB</b>
        </span>
        <span>
          Соединение:{" "}
          <b
            className={
              p2p.route === "TURN" ? "text-amber-300" : "text-emerald-300"
            }
          >
            {p2p.route}
          </b>
        </span>
      </div>
      {p2p.error && (
        <div className="border-t border-red-500/20 bg-red-950/60 px-4 py-3 text-sm text-red-200">
          {p2p.error}
        </div>
      )}
    </div>
  );
}
