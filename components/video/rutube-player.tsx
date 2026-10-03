"use client";

import { useRef } from "react";
import { Expand, ExternalLink, Loader2 } from "lucide-react";
import type { Socket } from "socket.io-client";
import { useRutubePlayer } from "@/hooks/use-rutube-player";
import { buildRutubeEmbedUrl } from "@/lib/video-source";
import type { ClientToServerEvents, ServerToClientEvents, VideoSource, VideoState } from "@/types/realtime";

type RutubeSource = Extract<VideoSource, { provider: "rutube" }>;

export function RutubePlayer({ socket, isHost, canControl, video, source }: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  canControl: boolean;
  video: VideoState;
  source: RutubeSource;
}) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const player = useRutubePlayer({ iframeRef, socket, isHost, canControl, video });
  const fallbackTitle = player.status === "embed-restricted"
    ? "RUTUBE не разрешает воспроизводить это видео на сторонних сайтах."
    : player.status === "unavailable"
      ? "Это видео сейчас недоступно на RUTUBE."
      : "RUTUBE не смог начать воспроизведение этого видео.";
  const showFallback = player.status === "embed-restricted" || player.status === "unavailable" || player.status === "player-error";

  return <div ref={containerRef} className="relative aspect-video bg-black" data-player-status={player.status}>
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
    {!canControl && <div className="absolute inset-0 z-[2] bg-transparent" aria-label="Управление видео доступно по разрешению Host" />}
    {player.status === "loading" && <div className="pointer-events-none absolute inset-0 z-[3] grid place-items-center bg-black/70"><div className="text-center"><Loader2 className="mx-auto size-8 animate-spin text-blue-400" /><p className="mt-3 text-sm text-slate-300">Загрузка RUTUBE player…</p></div></div>}
    {showFallback && <div className="absolute inset-0 z-[3] grid place-items-center bg-slate-950/95 p-6" data-testid="rutube-fallback"><div className="max-w-lg text-center"><p className="text-base font-semibold text-white">{fallbackTitle}</p><a className="button-primary mx-auto mt-5 w-fit" href={source.originalUrl} target="_blank" rel="noopener noreferrer"><ExternalLink className="size-4" />Открыть на RUTUBE</a><p className="mt-4 text-sm text-slate-400">Выберите другое видео RUTUBE или используйте фильм с компьютера Host.</p></div></div>}
    {player.advertising && <span className="pointer-events-none absolute left-3 top-3 rounded-lg bg-black/70 px-2.5 py-1 text-xs text-slate-200">Реклама · синхронизация приостановлена</span>}
    <button onClick={() => void containerRef.current?.requestFullscreen()} className="absolute right-3 top-3 z-[4] rounded-lg bg-black/60 p-2 text-white hover:bg-black/80" title="Полный экран"><Expand className="size-5" /></button>
    {player.duration !== null && <span className="pointer-events-none absolute bottom-3 right-3 rounded bg-black/60 px-2 py-1 text-[10px] text-slate-400">RUTUBE · {Math.round(player.duration / 60)} мин</span>}
  </div>;
}
