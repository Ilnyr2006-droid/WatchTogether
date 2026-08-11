"use client";

import { useRef } from "react";
import { Expand, Loader2 } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useRutubePlayer } from "@/hooks/use-rutube-player";
import { buildRutubeEmbedUrl } from "@/lib/video-source";
import type { ClientToServerEvents, ServerToClientEvents, VideoSource, VideoState } from "@/types/realtime";

type RutubeSource = Extract<VideoSource, { provider: "rutube" }>;

export function RutubePlayer({ socket, isHost, video, source }: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  video: VideoState;
  source: RutubeSource;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const player = useRutubePlayer({ iframeRef, socket, isHost, video });

  return <div ref={containerRef} className="relative aspect-video bg-black">
    <iframe
      ref={iframeRef}
      key={source.videoId + (source.accessKey ? ":private" : "")}
      src={buildRutubeEmbedUrl(source)}
      title="RUTUBE player"
      className="h-full w-full border-0"
      allow="clipboard-write; autoplay; fullscreen; picture-in-picture"
      allowFullScreen
      referrerPolicy="strict-origin-when-cross-origin"
    />
    {!isHost && <div className="absolute inset-0 z-[1]" title="Просмотром управляет host" aria-hidden="true" />}
    {!player.ready && <div className="pointer-events-none absolute inset-0 grid place-items-center bg-black/70"><div className="text-center"><Loader2 className="mx-auto size-8 animate-spin text-blue-400" /><p className="mt-3 text-sm text-slate-300">Загрузка RUTUBE player…</p></div></div>}
    {player.advertising && <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/70 px-2.5 py-1 text-xs text-slate-200">Реклама · синхронизация приостановлена</span>}
    {player.error && <div className="absolute bottom-3 left-3 rounded-lg bg-red-950/90 px-3 py-2 text-sm text-red-200">{player.error}</div>}
    <button onClick={() => void containerRef.current?.requestFullscreen()} className="absolute right-3 top-3 z-[2] rounded-lg bg-black/60 p-2 text-white hover:bg-black/80" title="Полный экран"><Expand className="size-5" /></button>
    {player.duration !== null && <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/60 px-2 py-1 text-[10px] text-slate-400">RUTUBE · {Math.round(player.duration / 60)} мин</span>}
  </div>;
}
