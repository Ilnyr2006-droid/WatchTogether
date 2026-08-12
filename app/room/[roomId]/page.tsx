"use client";

import { useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, LogOut, Wifi, WifiOff } from "lucide-react";
import { Logo } from "@/components/logo";
import { ChatPanel } from "@/components/chat/chat-panel";
import { Participants } from "@/components/room/participants";
import { VideoPlayer } from "@/components/video/video-player";
import { useSocket } from "@/hooks/use-socket";
import { useVoiceChat } from "@/hooks/use-voice-chat";
import { VoiceControls } from "@/components/voice/voice-controls";
import type { Participant, RoomState, VideoState } from "@/types/realtime";

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { socket, connected } = useSocket();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [streamToken, setStreamToken] = useState("");
  const username =
    typeof window === "undefined"
      ? ""
      : (sessionStorage.getItem("watchtogether:username") ?? "");
  const tokenFromUrl = searchParams.get("token") ?? "";
  const roomToken =
    typeof window === "undefined"
      ? tokenFromUrl
      : tokenFromUrl ||
        sessionStorage.getItem(`watchtogether:room-token:${params.roomId}`) ||
        "";
  const storedInvitation =
    typeof window === "undefined"
      ? ""
      : sessionStorage.getItem(`watchtogether:invitation:${params.roomId}`) ||
        "";
  const networkInfo =
    typeof window === "undefined"
      ? null
      : readNetworkInfo(sessionStorage.getItem("watchtogether:network"));
  const voice = useVoiceChat(socket, room?.participants ?? []);

  useEffect(() => {
    if (!connected) return;
    if (!username) {
      if (roomToken)
        sessionStorage.setItem(
          `watchtogether:room-token:${params.roomId}`,
          roomToken,
        );
      router.replace(
        `/?room=${params.roomId}&token=${encodeURIComponent(roomToken)}`,
      );
      return;
    }
    if (!roomToken) return;
    socket.emit(
      "room:join",
      { roomId: params.roomId, username, roomToken },
      (response) => {
        if (response.ok) {
          sessionStorage.setItem(
            `watchtogether:room-token:${params.roomId}`,
            roomToken,
          );
          setRoom(response.data.room);
          setStreamToken(response.data.streamToken);
          setError("");
        } else setError(response.error);
      },
    );
  }, [connected, params.roomId, roomToken, router, socket, username]);

  useEffect(() => {
    const state = (next: RoomState) => setRoom(next);
    const videoState = (video: VideoState) =>
      setRoom((current) => (current ? { ...current, video } : current));
    const joined = (participant: Participant) =>
      setRoom((current) =>
        current
          ? {
              ...current,
              participants: [
                ...current.participants.filter(
                  (p) => p.socketId !== participant.socketId,
                ),
                participant,
              ],
            }
          : current,
      );
    const updated = (participant: Participant) =>
      setRoom((current) =>
        current
          ? {
              ...current,
              participants: current.participants.map((p) =>
                p.socketId === participant.socketId ? participant : p,
              ),
            }
          : current,
      );
    const left = ({
      socketId,
      hostId,
    }: {
      socketId: string;
      hostId: string | null;
    }) =>
      setRoom((current) =>
        current
          ? {
              ...current,
              hostId: hostId ?? current.hostId,
              participants: current.participants.filter(
                (p) => p.socketId !== socketId,
              ),
            }
          : current,
      );
    const serverError = ({ message }: { message: string }) => setError(message);
    socket.on("room:state", state);
    socket.on("video:state", videoState);
    socket.on("participant:joined", joined);
    socket.on("participant:update", updated);
    socket.on("participant:left", left);
    socket.on("room:error", serverError);
    return () => {
      socket.off("room:state", state);
      socket.off("video:state", videoState);
      socket.off("participant:joined", joined);
      socket.off("participant:update", updated);
      socket.off("participant:left", left);
      socket.off("room:error", serverError);
    };
  }, [socket]);

  const copy = async () => {
    await navigator.clipboard.writeText(
      storedInvitation || window.location.href,
    );
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  };
  const leave = () => {
    socket.emit("room:leave");
  };
  const goHome = () => {
    socket.emit("room:leave");
    sessionStorage.removeItem(`watchtogether:room-token:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:invitation:${params.roomId}`);
  };

  if (!room) {
    const blockingError =
      error ||
      (!roomToken && username
        ? "Нужна полная ссылка-приглашение с секретным token"
        : "");
    return (
      <main className="grid min-h-screen place-items-center px-5">
        <div className="text-center">
          <Logo />
          {!blockingError && (
            <div className="mt-8">
              <span className="inline-block size-9 animate-spin rounded-full border-2 border-violet-500 border-t-transparent" />
            </div>
          )}
          <p className="mt-4 text-slate-400">
            {blockingError || "Подключаемся к комнате…"}
          </p>
          {blockingError && (
            // A document reload is intentional: a failed room can leave the
            // client router in a stale state after its URL already changed.
            // eslint-disable-next-line @next/next/no-html-link-for-pages
            <a
              href="/"
              className="button-secondary mt-5"
              onClick={goHome}
            >
              На главную
            </a>
          )}
        </div>
      </main>
    );
  }

  const isHost = room.hostId === socket.id;
  return (
    <main className="min-h-screen px-4 py-4 sm:px-6 lg:px-8">
      <header className="mx-auto mb-5 flex max-w-[1600px] flex-wrap items-center justify-between gap-3">
        <Logo />
        <div className="flex items-center gap-2">
          <span
            className={`hidden items-center gap-1.5 text-xs sm:flex ${connected ? "text-emerald-400" : "text-amber-400"}`}
          >
            {connected ? (
              <Wifi className="size-4" />
            ) : (
              <WifiOff className="size-4" />
            )}
            {connected ? "Подключено" : "Переподключение…"}
          </span>
          <button className="button-secondary py-2 text-sm" onClick={copy}>
            {copied ? (
              <Check className="size-4 text-emerald-400" />
            ) : (
              <Copy className="size-4" />
            )}
            <span className="hidden sm:inline">
              {copied ? "Скопировано" : "Пригласить"}
            </span>
          </button>
          {/* A full reload guarantees all room and WebRTC state is discarded. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a
            href="/"
            className="button-secondary py-2 text-sm text-red-300"
            onClick={leave}
          >
            <LogOut className="size-4" />
            <span className="hidden sm:inline">Выйти</span>
          </a>
        </div>
      </header>
      {error && (
        <div className="mx-auto mb-4 max-w-[1600px] rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {voice.error && (
        <div className="mx-auto mb-4 max-w-[1600px] rounded-xl border border-amber-500/20 bg-amber-500/10 px-4 py-3 text-sm text-amber-100">
          {voice.error}
        </div>
      )}
      <div className="mx-auto grid max-w-[1600px] gap-5 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="min-w-0">
          <VideoPlayer
            socket={socket}
            isHost={isHost}
            hostId={room.hostId}
            participants={room.participants}
            video={room.video}
            roomId={room.id}
            streamToken={streamToken}
          />
          <div className="mt-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="font-mono text-sm text-slate-400">
                Room ID: <span className="text-white">{room.id}</span>
              </p>
              {isHost && storedInvitation && (
                <p className="mt-1 max-w-2xl break-all font-mono text-xs text-violet-300">
                  {storedInvitation}
                </p>
              )}
              {isHost && storedInvitation.startsWith("http://") && (
                <p className="mt-1 text-xs text-amber-300">
                  HTTP подходит для проверки видео, но удалённый микрофон
                  требует HTTPS. Настройте домен и Caddy.
                </p>
              )}
              {isHost && networkInfo && (
                <p className="mt-1 text-xs text-slate-500">
                  Public IPv4: {networkInfo.publicIp || "не определён"} ·
                  application port: {networkInfo.port}
                </p>
              )}
              <p className="mt-1 text-xs text-slate-600">
                {isHost
                  ? "Вы управляете просмотром"
                  : "Просмотром управляет Host"}
              </p>
            </div>
            <VoiceControls voice={voice} />
          </div>
        </div>
        <aside className="grid content-start gap-4 md:grid-cols-2 xl:grid-cols-1">
          <Participants
            participants={room.participants}
            hostId={room.hostId}
            currentSocketId={socket.id}
            voiceStates={voice.peerStates}
            speaking={voice.speaking}
          />
          <ChatPanel socket={socket} initialMessages={room.messages} />
        </aside>
      </div>
    </main>
  );
}

function readNetworkInfo(value: string | null) {
  try {
    const parsed = JSON.parse(value || "null") as {
      publicIp?: unknown;
      port?: unknown;
    } | null;
    return parsed &&
      (typeof parsed.publicIp === "string" || parsed.publicIp === null) &&
      typeof parsed.port === "number"
      ? { publicIp: parsed.publicIp, port: parsed.port }
      : null;
  } catch {
    return null;
  }
}
