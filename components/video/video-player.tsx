"use client";

import { FormEvent, useEffect, useState } from "react";
import { FileVideo, Link2, Loader2 } from "lucide-react";
import type { Socket } from "socket.io-client";
import { inspectP2PMovie } from "@/lib/mp4-file-segmenter";
import { publicSourceLabel } from "@/lib/video-source";
import type {
  ClientToServerEvents,
  P2PMovieSourceInput,
  Participant,
  ServerToClientEvents,
  VideoState,
} from "@/types/realtime";
import { Html5Player } from "./html5-player";
import { RutubePlayer } from "./rutube-player";
import { P2PMoviePlayer } from "./p2p-movie-player";

type SourceChoice = "rutube" | "url" | "local" | "host-stream" | "p2p-movie";
interface HostMediaItem {
  id: string;
  fileName: string;
  size: number;
  browserCompatible: boolean;
}

const choices: { value: SourceChoice; label: string }[] = [
  { value: "rutube", label: "RUTUBE" },
  { value: "url", label: "Видео по URL" },
  { value: "local", label: "Локальный файл у каждого" },
  { value: "host-stream", label: "Фильм с компьютера Host" },
  { value: "p2p-movie", label: "P2P фильм с компьютера" },
];

export function VideoPlayer({
  socket,
  isHost,
  hostId,
  participants,
  video,
  roomId,
  streamToken,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  video: VideoState;
  roomId: string;
  streamToken: string;
  hostId: string;
  participants: Participant[];
}) {
  const [input, setInput] = useState("");
  const [localUrl, setLocalUrl] = useState<string | null>(null);
  const [localFileName, setLocalFileName] = useState<string | null>(null);
  const [choice, setChoice] = useState<SourceChoice>("rutube");
  const [loading, setLoading] = useState(false);
  const [sourceError, setSourceError] = useState("");
  const [hostFiles, setHostFiles] = useState<HostMediaItem[]>([]);
  const [selectedHostFile, setSelectedHostFile] = useState("");
  const [p2pFile, setP2pFile] = useState<File | null>(null);
  const [p2pMetadata, setP2pMetadata] = useState<P2PMovieSourceInput | null>(
    null,
  );

  useEffect(
    () => () => {
      if (localUrl) URL.revokeObjectURL(localUrl);
    },
    [localUrl],
  );

  function submitUrl(event: FormEvent) {
    event.preventDefault();
    if (!input.trim()) return;
    setLoading(true);
    setSourceError("");
    socket.emit("video:set-source", { input: input.trim() });
    window.setTimeout(() => setLoading(false), 500);
  }

  function selectFile(file?: File) {
    if (!file) return;
    if (localUrl) URL.revokeObjectURL(localUrl);
    setLocalUrl(URL.createObjectURL(file));
    setLocalFileName(file.name);
    if (isHost) socket.emit("video:set-source", { localFileName: file.name });
    const expectedName =
      video.source?.provider === "html5" && video.source.mode === "local"
        ? video.source.fileName
        : null;
    socket.emit("participant:update", {
      ready: !expectedName || expectedName === file.name,
    });
  }

  async function loadHostFiles() {
    if (!streamToken)
      return setSourceError(
        "Сессия комнаты ещё не готова. Попробуйте снова через секунду.",
      );
    setLoading(true);
    setSourceError("");
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/host-stream/files`,
        {
          headers: { Authorization: `Bearer ${streamToken}` },
          cache: "no-store",
        },
      );
      const body = (await response.json()) as {
        files?: HostMediaItem[];
        error?: string;
      };
      if (!response.ok || !body.files)
        throw new Error(body.error || "Не удалось получить список фильмов");
      setHostFiles(body.files);
      setSelectedHostFile((current) =>
        body.files?.some((file) => file.id === current)
          ? current
          : body.files?.[0]?.id || "",
      );
    } catch (error) {
      setSourceError(
        error instanceof Error
          ? error.message
          : "Не удалось получить список фильмов",
      );
    } finally {
      setLoading(false);
    }
  }

  async function selectHostStream() {
    if (!streamToken)
      return setSourceError(
        "Сессия комнаты ещё не готова. Попробуйте снова через секунду.",
      );
    if (!selectedHostFile)
      return setSourceError("В настроенной папке нет доступных видеофайлов");
    setLoading(true);
    setSourceError("");
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/host-stream/select`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${streamToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ fileId: selectedHostFile }),
        },
      );
      const body = (await response.json()) as { error?: string };
      if (!response.ok)
        throw new Error(body.error || "Не удалось выбрать файл");
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Не удалось выбрать файл",
      );
    } finally {
      setLoading(false);
    }
  }

  async function pickHostStream() {
    if (!streamToken)
      return setSourceError(
        "Сессия комнаты ещё не готова. Попробуйте снова через секунду.",
      );
    setLoading(true);
    setSourceError("");
    try {
      const response = await fetch(
        `/api/rooms/${encodeURIComponent(roomId)}/host-stream/pick`,
        { method: "POST", headers: { Authorization: `Bearer ${streamToken}` } },
      );
      const body = (await response.json()) as {
        cancelled?: boolean;
        fileName?: string;
        error?: string;
      };
      if (!response.ok)
        throw new Error(body.error || "Не удалось выбрать файл");
    } catch (error) {
      setSourceError(
        error instanceof Error ? error.message : "Не удалось выбрать файл",
      );
    } finally {
      setLoading(false);
    }
  }

  async function selectP2PMovie(file?: File) {
    if (!file) return;
    setLoading(true);
    setSourceError("");
    try {
      const metadata = await inspectP2PMovie(file);
      setP2pFile(file);
      setP2pMetadata(metadata);
      socket.emit("video:set-source", { p2pMovie: metadata });
    } catch (error) {
      setP2pFile(null);
      setP2pMetadata(null);
      setSourceError(
        error instanceof Error ? error.message : "Не удалось прочитать MP4",
      );
    } finally {
      setLoading(false);
    }
  }

  const isLocal =
    video.source?.provider === "html5" && video.source.mode === "local";

  return (
    <section className="panel overflow-hidden">
      {video.source?.provider === "rutube" ? (
        <RutubePlayer
          key={
            video.source.videoId + (video.source.accessKey ? ":private" : "")
          }
          socket={socket}
          isHost={isHost}
          video={video}
          source={video.source}
        />
      ) : video.source?.provider === "html5" &&
        video.source.mode === "p2p-movie" ? (
        <P2PMoviePlayer
          key={video.source.sourceId}
          socket={socket}
          isHost={isHost}
          hostId={hostId}
          participants={participants}
          video={video}
          file={p2pFile}
        />
      ) : (
        <Html5Player
          socket={socket}
          isHost={isHost}
          video={video}
          localUrl={localUrl}
          localFileName={localFileName}
          roomId={roomId}
          streamToken={streamToken}
        />
      )}
      <div className="border-t border-white/10 p-4">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-slate-300">
            Источник видео
          </h2>
          <span
            className={`rounded-full px-2.5 py-1 text-xs font-medium ${video.source?.provider === "rutube" ? "bg-blue-500/15 text-blue-300" : "bg-white/5 text-slate-400"}`}
          >
            {publicSourceLabel(video.source)}
          </span>
        </div>
        {(isHost ? choices : choices.filter((item) => item.value === "rutube" || item.value === "url")).length > 0 && (
          <div className="mb-3 grid grid-cols-2 gap-2 lg:grid-cols-4">
            {(isHost ? choices : choices.filter((item) => item.value === "rutube" || item.value === "url")).map((item) => (
              <button
                key={item.value}
                type="button"
                onClick={() => {
                  setChoice(item.value);
                  setSourceError("");
                }}
                className={`rounded-lg border px-2 py-2 text-xs transition ${choice === item.value ? "border-violet-400 bg-violet-500/15 text-violet-200" : "border-white/10 bg-white/[0.03] text-slate-400 hover:bg-white/[0.06]"}`}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
        {(choice === "rutube" || choice === "url") && (
          <form
            className="flex flex-col gap-2 sm:flex-row"
            onSubmit={submitUrl}
          >
            <div className="relative flex-1">
              <Link2 className="absolute left-3 top-3 size-5 text-slate-500" />
              <input
                className="input py-2.5 pl-10"
                type="url"
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder={
                  choice === "rutube"
                    ? "https://rutube.ru/video/…"
                    : "https://cdn.example.com/movie.mp4"
                }
              />
            </div>
            <button
              className="button-primary py-2.5"
              disabled={!input.trim() || loading}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Link2 className="size-4" />
              )}
              {video.source ? "Сменить видео" : "Открыть"}
            </button>
          </form>
        )}
        {((isHost && choice === "local") || (!isHost && isLocal)) && (
          <div className="flex items-center gap-3">
            <label className="button-secondary cursor-pointer py-2.5">
              <FileVideo className="size-4" />
              {!isHost ? "Выбрать такой же файл" : "Выбрать локальный файл"}
              <input
                className="sr-only"
                type="file"
                accept="video/*,.mkv"
                onChange={(event) => selectFile(event.target.files?.[0])}
              />
            </label>
            {localUrl && (
              <span className="text-sm text-emerald-400">Файл готов</span>
            )}
          </div>
        )}
        {isHost && choice === "host-stream" && (
          <div className="space-y-3">
            <button
              type="button"
              className="button-primary py-2.5"
              disabled={loading || !streamToken}
              onClick={() => {
                void pickHostStream();
              }}
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <FileVideo className="size-4" />
              )}
              Выбрать фильм с диска
            </button>
            <p className="text-xs text-slate-500">
              Откроется системное окно Windows или macOS. Можно выбрать
              MP4/M4V/WebM из любой папки или диска. Полный путь останется
              только на локальном сервере.
            </p>
            <div className="border-t border-white/10 pt-3">
              <button
                type="button"
                className="button-secondary mb-2 py-2"
                disabled={loading || !streamToken}
                onClick={() => {
                  void loadHostFiles();
                }}
              >
                Показать дополнительную папку
              </button>
              {hostFiles.length > 0 && (
                <div className="flex flex-col gap-2 sm:flex-row">
                  <select
                    className="input py-2.5"
                    value={selectedHostFile}
                    onChange={(event) =>
                      setSelectedHostFile(event.target.value)
                    }
                    disabled={loading}
                  >
                    <option value="">Выберите фильм</option>
                    {hostFiles.map((file) => (
                      <option key={file.id} value={file.id}>
                        {file.fileName}
                        {file.browserCompatible
                          ? ""
                          : " — требуется конвертация"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    className="button-secondary shrink-0 py-2.5"
                    disabled={loading || !selectedHostFile}
                    onClick={() => {
                      void selectHostStream();
                    }}
                  >
                    Запустить из папки
                  </button>
                </div>
              )}
            </div>
          </div>
        )}
        {isHost && choice === "p2p-movie" && (
          <div className="space-y-3">
            <label className="button-primary w-fit cursor-pointer py-2.5">
              <FileVideo className="size-4" />
              {loading ? "Анализ MP4…" : "Выбрать P2P-фильм"}
              <input
                className="sr-only"
                type="file"
                accept="video/*,.mp4,.mkv,.avi,.mov,.m4v,.ts,.m2ts,.wmv"
                disabled={loading}
                onClick={(event) => {
                  event.currentTarget.value = "";
                }}
                onChange={(event) => {
                  void selectP2PMovie(event.target.files?.[0]);
                }}
              />
            </label>
            <p className="text-xs text-slate-500">
              MP4 H.264/AVC + AAC. Файл остаётся в браузере Host и передаётся
              другу только через WebRTC DataChannel.
            </p>
            {p2pMetadata && (
              <div className="grid gap-1 rounded-lg bg-white/[0.04] p-3 text-xs text-slate-300 sm:grid-cols-2">
                <span>Имя: {p2pMetadata.fileName}</span>
                <span>
                  Размер: {(p2pMetadata.size / 1024 / 1024).toFixed(1)} MB
                </span>
                <span>
                  Длительность: {Math.round(p2pMetadata.duration / 60)} мин
                </span>
                <span>Кодеки: {p2pMetadata.codecs.join(", ")}</span>
                <span>
                  Разрешение:{" "}
                  {p2pMetadata.width && p2pMetadata.height
                    ? `${p2pMetadata.width}×${p2pMetadata.height}`
                    : "не определено"}
                </span>
              </div>
            )}
          </div>
        )}
        {sourceError && (
          <p className="mt-3 rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {sourceError}
          </p>
        )}
        {!isHost && (
          <p className="mt-2 text-xs text-slate-500">
            Вы можете менять ссылку и управлять воспроизведением.
          </p>
        )}
      </div>
    </section>
  );
}
