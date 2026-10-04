"use client";

import { useCallback, useEffect, useState } from "react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import { Check, Copy, Info, LogOut } from "lucide-react";
import { Logo } from "@/components/logo";
import { ConnectionNotice } from "@/app/connection-notice";
import { VideoPlayer } from "@/components/video/video-player";
import { useSocket } from "@/hooks/use-socket";
import { useVoiceChat } from "@/hooks/use-voice-chat";
import { RoomDrawer, RoomTabs, type RoomDrawerTab } from "@/components/room/room-drawer";
import { VoiceControls } from "@/components/voice/voice-controls";
import { isNewerVideoRevision } from "@/lib/video-sync";
import { publicSourceLabel } from "@/lib/video-source";
import type { Participant, RoomState, VideoState } from "@/types/realtime";

export default function RoomPage() {
  const params = useParams<{ roomId: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { socket, connected } = useSocket();
  const [room, setRoom] = useState<RoomState | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [activeTab, setActiveTab] = useState<RoomDrawerTab | null>(null);
  const [queueSlot, setQueueSlot] = useState<HTMLDivElement | null>(null);
  const [streamToken, setStreamToken] = useState("");
  const [participantId, setParticipantId] = useState("");
  const [isOwner, setIsOwner] = useState(false);
  const queueSlotRef = useCallback((node: HTMLDivElement | null) => setQueueSlot(node), []);
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
  const ownerToken =
    typeof window === "undefined"
      ? ""
      : sessionStorage.getItem(`watchtogether:owner-token:${params.roomId}`) || "";
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
      {
        roomId: params.roomId, username, roomToken, ownerToken: ownerToken || undefined,
        participantId: sessionStorage.getItem(`watchtogether:participant-id:${params.roomId}`) || undefined,
        sessionToken: sessionStorage.getItem(`watchtogether:session-token:${params.roomId}`) || undefined,
      },
      (response) => {
        if (response.ok) {
          sessionStorage.setItem(
            `watchtogether:room-token:${params.roomId}`,
            roomToken,
          );
          setRoom(response.data.room);
          setStreamToken(response.data.streamToken);
          setParticipantId(response.data.participantId);
          setIsOwner(response.data.isOwner);
          sessionStorage.setItem(`watchtogether:participant-id:${params.roomId}`, response.data.participantId);
          sessionStorage.setItem(`watchtogether:session-token:${params.roomId}`, response.data.sessionToken);
          if (response.data.room.hostId === response.data.participantId && ownerToken)
            sessionStorage.setItem(`watchtogether:owner-token:${params.roomId}`, ownerToken);
          setError("");
        } else setError(response.error);
      },
    );
  }, [connected, ownerToken, params.roomId, roomToken, router, socket, username]);

  useEffect(() => {
    const state = (next: RoomState) => setRoom((current) => current && !isNewerVideoRevision(current.video.revision, next.video.revision) ? { ...next, video: current.video } : next);
    const videoState = (video: VideoState) =>
      setRoom((current) => current && isNewerVideoRevision(current.video.revision, video.revision) ? { ...current, video } : current);
    const joined = (participant: Participant) =>
      setRoom((current) =>
        current
          ? {
              ...current,
              participants: [
                ...current.participants.filter(
                  (p) => p.id !== participant.id,
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
                p.id === participant.id ? participant : p,
              ),
            }
          : current,
      );
    const left = ({
      participantId: leftParticipantId,
      hostId,
    }: {
      participantId: string;
      hostId: string | null;
    }) =>
      setRoom((current) =>
        current
          ? {
              ...current,
              hostId: hostId ?? current.hostId,
              participants: current.participants.filter(
                (p) => p.id !== leftParticipantId,
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
    let navigated = false;
    const finish = () => {
      if (navigated) return;
      navigated = true;
      sessionStorage.removeItem(`watchtogether:participant-id:${params.roomId}`);
      sessionStorage.removeItem(`watchtogether:session-token:${params.roomId}`);
      router.push("/");
    };
    socket.emit("room:leave", finish);
    window.setTimeout(finish, 750);
  };
  const goHome = () => {
    socket.emit("room:leave");
    sessionStorage.removeItem(`watchtogether:room-token:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:invitation:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:owner-token:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:participant-id:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:session-token:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:participant-id:${params.roomId}`);
    sessionStorage.removeItem(`watchtogether:session-token:${params.roomId}`);
  };

  if (!room) {
    const blockingError =
      error ||
      (!roomToken && username
        ? "Нужна полная ссылка-приглашение с секретным token"
        : "");
    return (
      <main className="cinema-shell grid min-h-screen place-items-center px-5">
        <ConnectionNotice connected={connected} />
        <div className="text-center">
          <Logo />
          {!blockingError && (
            <div className="mt-8">
          <span className="inline-block size-9 animate-spin rounded-full border-2 border-white/50 border-t-transparent" />
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

  const isHost = room.hostId === participantId;
  const canControl = isHost || room.controlMode === "everyone" || (room.controlMode === "approved" && room.approvedControllerIds.includes(participantId));
  const currentPlaylistItem = room.playlist.find((item) => item.id === room.currentPlaylistItemId) ?? null;
  const movieTitle = currentPlaylistItem?.title ?? (room.video.source ? publicSourceLabel(room.video.source) : "Ничего не воспроизводится");
  const controlStatus = isHost ? "Вы управляете просмотром" : room.controlMode === "everyone" ? "Вы можете управлять просмотром" : room.controlMode === "approved" && canControl ? "Вам разрешено управлять просмотром" : "Просмотром управляет Host";
  const selectTab = (tab: RoomDrawerTab) => setActiveTab((current) => current === tab ? null : tab);
  return (
    <main className="cinema-shell">
      <ConnectionNotice connected={connected} monitorServer />
      <div className="room-main">
        <header className="room-topbar">
          <Logo />
          <span className="room-status"><i className={`status-dot ${connected ? "is-online" : "is-waiting"}`} />{connected ? "Подключено" : "Переподключение…"}</span>
          <span className="room-topbar-spacer" />
          <div className="room-avatar-stack" aria-label={`Участников: ${room.participants.length}`}>
            {room.participants.slice(0, 3).map((person) => <span key={person.id} className="room-avatar" title={`${person.username}${person.id === room.hostId ? " · Host" : ""}`} style={{ opacity: person.connected ? 1 : .48 }}>{person.username.slice(0, 1).toUpperCase()}</span>)}
            {room.participants.length > 3 && <span className="room-avatar room-avatar-more">+{room.participants.length - 3}</span>}
          </div>
          <button type="button" className="room-header-button invite-button" onClick={copy} aria-label={copied ? "Приглашение скопировано" : "Пригласить участников"}>
            {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}<span>{copied ? "Скопировано" : "Пригласить"}</span>
          </button>
          <details className="room-info">
            <summary aria-label="Информация о комнате"><Info aria-hidden="true" /></summary>
            <div className="room-info-popover"><h2>Информация о комнате</h2><p>Код комнаты: <code>{room.id}</code></p>{isHost && networkInfo && <p>Сетевой адрес: {networkInfo.publicIp || "не определён"} · порт {networkInfo.port}</p>}{isHost && storedInvitation.startsWith("http://") && <p>Для удалённого микрофона браузеру требуется защищённое HTTPS-подключение.</p>}</div>
          </details>
          <button type="button" className="room-header-button is-exit" onClick={leave} aria-label="Выйти из комнаты"><LogOut aria-hidden="true" /><span className="sr-only">Выйти</span></button>
        </header>
        {error && <div className="room-error" role="alert">{error}</div>}
        {voice.error && <div className="room-error" role="alert">{voice.error}</div>}

        <RoomTabs activeTab={activeTab} onSelect={selectTab} />
        <div className={`room-workspace ${activeTab ? "with-drawer" : ""}`}>
          <div className="room-stage-column">
            <div className="room-stage"><VideoPlayer
              socket={socket}
              isHost={isHost}
              isOwner={isOwner}
              canControl={canControl}
              hostId={room.hostId}
              participants={room.participants}
              video={room.video}
              roomId={room.id}
              streamToken={streamToken}
              playlist={room.playlist}
              currentPlaylistItemId={room.currentPlaylistItemId}
              currentPlaylistPlaybackId={room.currentPlaylistPlaybackId}
              queuePortal={queueSlot}
            /></div>
            <div className="room-movie-meta">
              <div><h1>{movieTitle}</h1><p>{room.video.source ? controlStatus : isHost ? "Добавьте фильм, чтобы начать совместный просмотр" : "Ожидаем, пока Host выберет фильм"}</p></div>
              <div className="voice-controls"><VoiceControls voice={voice} /></div>
            </div>
          </div>
          <RoomDrawer activeTab={activeTab} onClose={() => setActiveTab(null)} room={room} participantId={participantId} isHost={isHost} canControl={canControl} socket={socket} voice={voice} queueSlotRef={queueSlotRef} />
        </div>
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
