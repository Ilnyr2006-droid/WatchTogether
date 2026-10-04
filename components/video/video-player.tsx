"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowRight, ArrowUp, FileVideo, Link2, MoreHorizontal, Play, Plus, Trash2, X } from "lucide-react";
import type { Socket } from "socket.io-client";
import { inspectP2PMovie } from "@/lib/mp4-file-segmenter";
import { publicSourceLabel } from "@/lib/video-source";
import type {
  ClientToServerEvents,
  P2PMovieSourceInput,
  Participant,
  PlaylistItem,
  ServerToClientEvents,
  VideoState,
} from "@/types/realtime";
import { Html5Player } from "./html5-player";
import { RutubePlayer } from "./rutube-player";
import { P2PMoviePlayer } from "./p2p-movie-player";

interface HostMediaItem {
  id: string;
  fileName: string;
  size: number;
  browserCompatible: boolean;
}

export function VideoPlayer({
  socket,
  isHost,
  isOwner,
  canControl,
  hostId,
  participants,
  video,
  roomId,
  streamToken,
  playlist,
  currentPlaylistItemId,
  currentPlaylistPlaybackId,
  queuePortal,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  isOwner: boolean;
  canControl: boolean;
  video: VideoState;
  roomId: string;
  streamToken: string;
  hostId: string;
  participants: Participant[];
  playlist: PlaylistItem[];
  currentPlaylistItemId: string | null;
  currentPlaylistPlaybackId: string | null;
  queuePortal: HTMLElement | null;
}) {
  const [input, setInput] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [sourceChoice, setSourceChoice] = useState<"remote" | "computer">("remote");
  const [showSourcePicker, setShowSourcePicker] = useState(false);
  const [error, setError] = useState("");
  const [playlistErrorState, setPlaylistErrorState] = useState<{ itemId: string; message: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [hostFiles, setHostFiles] = useState<HostMediaItem[]>([]);
  const [durationState, setDurationState] = useState<{ sourceKey: string; duration: number } | null>(null);
  const [p2pFile, setP2pFile] = useState<File | null>(null);
  const [p2pMetadata, setP2pMetadata] = useState<P2PMovieSourceInput | null>(null);
  const isE2E = typeof document !== "undefined" && document.documentElement.dataset.watchtogetherE2e === "true";
  const currentItem = useMemo(() => playlist.find((item) => item.id === currentPlaylistItemId) ?? null, [currentPlaylistItemId, playlist]);
  const sourceKey = currentItem?.id ?? (video.source?.provider === "rutube"
    ? `rutube:${video.source.videoId}:${video.source.accessKey ?? ""}`
    : video.source?.provider === "html5"
      ? video.source.mode === "host-stream" ? `host-stream:${video.source.mediaId ?? video.source.streamId}`
        : video.source.mode === "url" ? `url:${video.source.url}`
          : video.source.mode === "local" ? `local:${video.source.fileName}` : `p2p:${video.source.sourceId}`
      : "none");
  const duration = durationState?.sourceKey === sourceKey ? durationState.duration : null;
  const playlistError = playlistErrorState?.itemId === currentPlaylistItemId ? playlistErrorState.message : "";

  useEffect(() => {
    const onPlaylistError = (payload: { itemId: string; message: string }) => {
      if (isHost) setPlaylistErrorState(payload);
    };
    socket.on("room:playlist-error", onPlaylistError);
    return () => { socket.off("room:playlist-error", onPlaylistError); };
  }, [isHost, socket]);

  function submitUrl(event: FormEvent) {
    event.preventDefault();
    if (!input.trim() || !canControl) return;
    setError("");
    socket.emit("video:set-source", { input: input.trim() });
  }

  function addRemoteToQueue() {
    if (!input.trim() || !canControl) return;
    setError("");
    socket.emit("playlist:add-remote", { input: input.trim() });
  }

  async function ownerRequest(path: string, init: RequestInit = {}) {
    if (!streamToken) throw new Error("Сессия комнаты ещё готовится. Попробуйте снова.");
    const response = await fetch(`/api/rooms/${encodeURIComponent(roomId)}/${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${streamToken}`, ...(init.headers ?? {}) },
      cache: "no-store",
    });
    const body = await response.json() as { item?: PlaylistItem; files?: HostMediaItem[]; error?: string; cancelled?: boolean };
    if (!response.ok) throw new Error(body.error || "Не удалось добавить фильм");
    return body;
  }

  async function registerPath() {
    setBusy(true);
    setError("");
    try {
      await ownerRequest("owner-media/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: localPath }) });
      setLocalPath("");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось добавить фильм");
    } finally { setBusy(false); }
  }

  async function pickLocalFile() {
    setBusy(true);
    setError("");
    try {
      const result = await ownerRequest("owner-media/pick", { method: "POST" });
      if (result.cancelled) return;
      if (!result.item) throw new Error("Сервер не зарегистрировал выбранный фильм");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось выбрать фильм");
    } finally { setBusy(false); }
  }

  async function browseLocalFiles() {
    setBusy(true);
    setError("");
    try {
      const result = await ownerRequest("owner-media/files");
      setHostFiles(result.files ?? []);
      if (!result.files?.length) setError("В доступном каталоге фильмов ничего не найдено. Можно указать путь к файлу.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось прочитать каталог фильмов");
    } finally { setBusy(false); }
  }

  async function selectCatalogFile(fileId: string) {
    setBusy(true);
    setError("");
    try {
      await ownerRequest("owner-media/select", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileId }) });
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "Не удалось добавить фильм");
    } finally { setBusy(false); }
  }

  async function selectP2PMovie(file?: File) {
    if (!file) return;
    setBusy(true);
    setError("");
    try {
      const metadata = await inspectP2PMovie(file);
      setP2pFile(file);
      setP2pMetadata(metadata);
      socket.emit("video:set-source", { p2pMovie: metadata });
    } catch (requestError) {
      setP2pFile(null);
      setP2pMetadata(null);
      setError(requestError instanceof Error ? requestError.message : "Не удалось прочитать MP4");
    } finally { setBusy(false); }
  }

  const bitrateMbps = currentItem?.source.type === "local" && duration && duration > 0
    ? currentItem.source.size * 8 / duration / 1_000_000
    : null;
  const remoteGuests = participants.filter((participant) => participant.connected && participant.id !== hostId).length;
  const requiredUpload = bitrateMbps === null ? null : bitrateMbps * remoteGuests;

  const queueContent = <section className="queue-panel" aria-label="Очередь видео">
    <div className="queue-heading"><h2>ОЧЕРЕДЬ</h2><span>{playlist.length.toString().padStart(2, "0")}</span></div>
    {currentItem && <div className="queue-now" data-testid="current-playlist-item"><p className="queue-kicker">СЕЙЧАС СМОТРИТЕ</p><h3>{currentItem.title}</h3>{currentItem.type === "local" && <p>Фильм с компьютера · {formatBytes(currentItem.source.size)}</p>}
      {currentItem.type === "local" && <div className="queue-ready" data-testid="local-media-ready">{participants.map((participant) => <p key={participant.id}>{participant.username} — {participant.ready ? "готов" : participant.connected ? "буферизация" : "переподключается"}</p>)}</div>}
      {isHost && currentItem.type === "local" && bitrateMbps !== null && <p data-testid="local-upload-estimate">Средний битрейт ≈ {bitrateMbps.toFixed(1)} Mbps · {remoteGuests} гостей · ориентировочная отдача ≈ {requiredUpload?.toFixed(1)} Mbps</p>}
      {isHost && currentPlaylistItemId && currentPlaylistPlaybackId && video.source?.provider === "rutube" && <button type="button" className="queue-footer-action" onClick={() => socket.emit("playlist:next", { itemId: currentPlaylistItemId, playbackId: currentPlaylistPlaybackId })}>Следующее видео</button>}
    </div>}
    {playlist.length === 0 ? <p className="queue-empty">Очередь пока пуста</p> : <><h3 className="queue-next-heading">ДАЛЕЕ</h3><ol className="queue-list">{playlist.map((item, index) => <li key={item.id} data-testid="playlist-item" data-playlist-item-id={item.id} className="queue-item"><span className="queue-number">{String(index + 1).padStart(2, "0")}</span><div className="queue-item-copy"><p>{item.title}</p><small>{item.source.type === "local" ? `Фильм с компьютера · ${formatBytes(item.source.size)}${item.id === currentPlaylistItemId ? " · готовность выше" : ""}` : item.source.input}</small></div>{isHost && <details className="queue-item-actions"><summary aria-label={`Действия для ${item.title}`}><MoreHorizontal aria-hidden="true" /></summary><div className="queue-action-menu">
      <button type="button" aria-label={`Запустить ${item.title}`} onClick={() => socket.emit("playlist:play", { itemId: item.id })}><Play className="mr-2 inline size-3.5" />Запустить сейчас</button>
      <button type="button" aria-label={`Переместить ${item.title} вверх`} disabled={index === 0} onClick={() => socket.emit("playlist:move", { itemId: item.id, direction: "up" })}><ArrowUp className="mr-2 inline size-3.5" />Переместить выше</button>
      <button type="button" aria-label={`Переместить ${item.title} вниз`} disabled={index === playlist.length - 1} onClick={() => socket.emit("playlist:move", { itemId: item.id, direction: "down" })}><ArrowDown className="mr-2 inline size-3.5" />Переместить ниже</button>
      <button type="button" aria-label={`Удалить ${item.title}`} onClick={() => socket.emit("playlist:remove", { itemId: item.id })}><Trash2 className="mr-2 inline size-3.5" />Удалить из очереди</button>
    </div></details>}</li>)}</ol></>}
    {isHost && playlist.length > 0 && <button type="button" className="queue-footer-action" onClick={() => socket.emit("playlist:clear")}>Очистить очередь</button>}
    {isHost && currentPlaylistItemId && currentPlaylistPlaybackId && video.source?.provider === "html5" && video.source.mode === "host-stream" && <button type="button" className="queue-footer-action" onClick={() => socket.emit("playlist:next", { itemId: currentPlaylistItemId, playbackId: currentPlaylistPlaybackId })}>Следующее видео</button>}
    {video.source?.provider === "html5" && video.source.mode === "local" && <LegacyLocalFileChoice socket={socket} fileName={video.source.fileName} />}
  </section>;

  return <>
    <section className="video-player-shell">
      <output className="sr-only" data-testid="video-state" data-revision={video.revision} data-playing={video.playing} data-time={video.currentTime} data-current-item={currentPlaylistItemId ?? ""} data-playback-id={currentPlaylistPlaybackId ?? ""} />
      {video.source?.provider === "rutube" ? (
        <RutubePlayer key={video.source.videoId + (video.source.accessKey ? ":private" : "")} socket={socket} isHost={isHost} canControl={canControl} roomName={roomId} video={video} source={video.source} />
      ) : video.source?.provider === "html5" && video.source.mode === "p2p-movie" ? (
        <P2PMoviePlayer key={video.source.sourceId} socket={socket} isHost={isHost} canControl={canControl} hostId={hostId} participants={participants} roomId={roomId} video={video} file={p2pFile} />
      ) : (
        <Html5Player socket={socket} isHost={isHost} canControl={canControl} video={video} localUrl={null} localFileName={null} roomId={roomId} streamToken={streamToken} currentPlaylistItemId={currentPlaylistItemId} currentPlaylistPlaybackId={currentPlaylistPlaybackId} onDurationChange={(value) => setDurationState({ sourceKey, duration: value })} />
      )}
      <div className="video-stage-meta"><span className="source-label">{publicSourceLabel(video.source)}</span><button type="button" className="source-trigger" aria-expanded={showSourcePicker} aria-controls="room-source-picker" onClick={() => setShowSourcePicker((open) => !open)}><Plus aria-hidden="true" />Добавить</button></div>
      {showSourcePicker && <section id="room-source-picker" className="source-picker" aria-label="Добавить видео">
        <div className="source-picker-head"><h3>Что смотрим?</h3><button type="button" className="source-picker-close" aria-label="Закрыть выбор видео" onClick={() => setShowSourcePicker(false)}><X aria-hidden="true" /></button></div>
        <div className="source-picker-options"><button type="button" className="source-option" aria-pressed={sourceChoice === "remote"} onClick={() => setSourceChoice("remote")}>URL / RUTUBE <ArrowRight aria-hidden="true" /></button><button type="button" className="source-option" aria-pressed={sourceChoice === "computer"} onClick={() => setSourceChoice("computer")}>Фильм с компьютера <ArrowRight aria-hidden="true" /></button></div>
        {sourceChoice === "remote" && canControl && <form className="flex flex-col gap-2 sm:flex-row" onSubmit={submitUrl}>
          <div className="relative flex-1"><Link2 className="absolute left-3 top-3 size-5 text-slate-500" /><input className="input py-2.5 pl-10" type="url" value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ссылка на RUTUBE или видеофайл" aria-label="URL / RUTUBE" /><span className="sr-only">URL / RUTUBE</span></div>
          <div className="source-queue-actions"><button className="button-primary" disabled={!input.trim()}><Play aria-hidden="true" />Сменить сейчас</button><button type="button" className="button-secondary" disabled={!input.trim()} onClick={addRemoteToQueue}>В очередь</button></div>
        </form>}
        {sourceChoice === "remote" && !canControl && <p className="mt-3 text-xs text-slate-400">Сейчас добавлять видео может только Host.</p>}
        {sourceChoice === "computer" && isOwner && <div className="mt-3 space-y-3" data-testid="owner-local-media-controls">
          <p className="text-xs text-slate-400">Файл останется на компьютере, где работает WatchTogether. Поддерживаются MP4/M4V и WebM без перекодирования.</p>
          <div className="flex flex-col gap-2 sm:flex-row"><input className="input py-2.5" aria-label="Локальный путь к фильму" placeholder="/путь/к/фильму.mp4" value={localPath} onChange={(event) => setLocalPath(event.target.value)} /><button type="button" className="button-primary py-2.5" disabled={busy || !localPath.trim()} onClick={() => void registerPath()}><FileVideo className="size-4" />Добавить</button></div>
          <div className="flex flex-wrap gap-2"><button type="button" className="button-secondary py-2" disabled={busy || !streamToken} onClick={() => void pickLocalFile()}><FileVideo className="size-4" />Открыть окно выбора</button><button type="button" className="button-secondary py-2" disabled={busy || !streamToken} onClick={() => void browseLocalFiles()}>Фильмы из каталога</button></div>
          {hostFiles.map((file) => <div key={file.id} className="flex flex-wrap items-center justify-between gap-2 py-2 text-sm"><span>{file.fileName} · {formatBytes(file.size)}{!file.browserCompatible && <span className="text-amber-300"> · формат не поддерживается</span>}</span><button type="button" className="button-secondary py-1.5" disabled={busy || !file.browserCompatible} onClick={() => void selectCatalogFile(file.id)}>Добавить в очередь</button></div>)}
        </div>}
        {sourceChoice === "computer" && !isOwner && <p className="mt-3 text-sm text-slate-400">Добавлять фильмы с диска может только первоначальный владелец комнаты.</p>}
        {isE2E && isOwner && <details className="mt-3 border-t border-white/10 pt-3" data-testid="p2p-test-only"><summary className="cursor-pointer text-xs text-slate-400">Диагностика источника</summary><label className="button-secondary mt-3 w-fit cursor-pointer py-2"><FileVideo className="size-4" />Выбрать P2P-фильм<input className="sr-only" type="file" accept="video/mp4,.mp4" onChange={(event) => void selectP2PMovie(event.target.files?.[0])} /></label>{p2pMetadata && <p className="mt-2 text-xs text-slate-400">{p2pMetadata.fileName} · {formatBytes(p2pMetadata.size)}</p>}</details>}
        {error && <p className="video-error" role="alert">{error}</p>}
        {isHost && playlistError && <p className="video-error" role="alert">{playlistError}</p>}
      </section>}
    </section>
    {queuePortal && createPortal(queueContent, queuePortal)}
  </>;
}

function LegacyLocalFileChoice({ socket, fileName }: { socket: Socket<ServerToClientEvents, ClientToServerEvents>; fileName: string }) {
  return <label className="button-secondary mt-3 w-fit cursor-pointer py-2">Выбрать локальный файл с таким же именем<input className="sr-only" type="file" accept="video/*" onChange={(event) => { if (event.target.files?.[0]?.name === fileName) socket.emit("participant:update", { ready: true }); }} /></label>;
}

function formatBytes(size: number) {
  if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(1)} GB`;
  return `${(size / 1024 ** 2).toFixed(1)} MB`;
}
