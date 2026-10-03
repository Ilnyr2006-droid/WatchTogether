import type { Server as HttpServer } from "node:http";
import { Server } from "socket.io";
import type {
  ClientToServerEvents,
  InterServerEvents,
  RoomControlAction,
  ServerToClientEvents,
  SocketData,
} from "@/types/realtime";
import { RoomManager } from "./room-manager";
import { RateLimiter } from "./rate-limit";
import {
  chatSendSchema,
  participantUpdateSchema,
  roomCreateSchema,
  roomJoinSchema,
  signalCandidateSchema,
  signalDescriptionSchema,
  videoActionSchema,
  videoSourceSelectionSchema,
  roomControlModeSchema,
  roomControlTargetSchema,
} from "./validation";
import { parseSubmittedVideoUrl } from "@/lib/video-source";
import type {
  SignalCandidate,
  SignalDescription,
  VideoSource,
} from "@/types/realtime";
import { canRelaySignal } from "./signaling";
import { HostStreamRegistry } from "./host-stream-registry";
import { FailedAttemptLimiter } from "./failed-attempt-limit";

export function attachSocketServer(
  httpServer: HttpServer,
  dependencies: { rooms?: RoomManager; streams?: HostStreamRegistry } = {},
) {
  const io = new Server<
    ClientToServerEvents,
    ServerToClientEvents,
    InterServerEvents,
    SocketData
  >(httpServer, {
    cors: { origin: process.env.ALLOWED_ORIGIN || false },
    maxHttpBufferSize: 100_000,
  });
  const rooms = dependencies.rooms ?? new RoomManager();
  const streams = dependencies.streams ?? new HostStreamRegistry();
  const chatRate = new RateLimiter(8, 10_000);
  const participantRate = new RateLimiter(20, 10_000);
  const videoRate = new RateLimiter(40, 10_000);
  const descriptionRate = new RateLimiter(20, 10_000);
  const iceCandidateRate = new RateLimiter(250, 10_000);
  const movieDescriptionRate = new RateLimiter(20, 10_000);
  const movieCandidateRate = new RateLimiter(250, 10_000);
  const failedJoinRate = new FailedAttemptLimiter(8, 60_000);
  const pendingDisconnectLeaves = new Map<string, { roomId: string; timer: ReturnType<typeof setTimeout> }>();

  io.on("connection", (socket) => {
    const fail = (message: string, code = "INVALID_REQUEST") =>
      socket.emit("room:error", { message, code });

    socket.on("room:create", (payload, ack) => {
      const parsed = roomCreateSchema.safeParse(payload);
      if (!parsed.success)
        return ack({ ok: false, error: "Введите имя длиной до 32 символов" });
      leaveCurrent();
      const room = rooms.create(socket.id, parsed.data.username);
      const roomToken = rooms.getRoomTokenForHost(socket.id);
      const ownerToken = rooms.getOwnerTokenForHost(socket.id);
      const credentials = rooms.getCredentials(socket.id);
      if (!roomToken || !ownerToken || !credentials)
        return ack({ ok: false, error: "Не удалось защитить комнату" });
      socket.data = { roomId: room.id, username: parsed.data.username, participantId: credentials.participantId };
      socket.join(room.id);
      ack({ ok: true, data: { roomId: room.id, roomToken, ownerToken, participantId: credentials.participantId, sessionToken: credentials.sessionToken } });
      socket.emit("room:state", room);
    });

    socket.on("room:join", (payload, ack) => {
      const attemptKey = socket.handshake.address || "unknown";
      if (failedJoinRate.isBlocked(attemptKey))
        return ack({
          ok: false,
          error: "Слишком много неудачных попыток. Подождите минуту",
        });
      const parsed = roomJoinSchema.safeParse(payload);
      if (!parsed.success) {
        failedJoinRate.recordFailure(attemptKey);
        return ack({
          ok: false,
          error: "Неверное приглашение или комната недоступна",
        });
      }
      if (socket.data.roomId && socket.data.roomId !== parsed.data.roomId)
        leaveCurrent();
      const joined = rooms.join(
        parsed.data.roomId,
        socket.id,
        parsed.data.username,
        parsed.data.roomToken,
        { ownerToken: parsed.data.ownerToken, participantId: parsed.data.participantId, sessionToken: parsed.data.sessionToken },
      );
      if (!joined) {
        failedJoinRate.recordFailure(attemptKey);
        return ack({
          ok: false,
          error: "Неверное приглашение или комната недоступна",
        });
      }
      failedJoinRate.clear(attemptKey);
      const { room: state, participantId } = joined;
      const pendingLeave = pendingDisconnectLeaves.get(participantId);
      if (pendingLeave) { clearTimeout(pendingLeave.timer); pendingDisconnectLeaves.delete(participantId); }
      socket.data = {
        roomId: parsed.data.roomId,
        username: parsed.data.username,
        participantId,
      };
      socket.join(parsed.data.roomId);
      if (joined.replacedSocketId) streams.closeParticipant(joined.replacedSocketId);
      const streamToken = rooms.issueStreamToken(socket.id);
      if (!streamToken)
        return ack({ ok: false, error: "Не удалось создать сессию комнаты" });
      ack({ ok: true, data: { room: state, streamToken, participantId, sessionToken: joined.sessionToken } });
      socket.emit("room:state", state);
      socket.to(parsed.data.roomId).emit("room:state", state);
      if (joined.replacedSocketId) io.sockets.sockets.get(joined.replacedSocketId)?.disconnect(true);
    });

    socket.on("room:leave", (ack) => { leaveCurrent(); ack?.({ ok: true, data: undefined }); });

    socket.on("room:control-mode", (payload) => {
      const parsed = roomControlModeSchema.safeParse(payload);
      if (!parsed.success) return;
      const state = rooms.setControlMode(socket.id, parsed.data.mode);
      if (!state) return fail("Только Host может менять режим управления", "FORBIDDEN");
      io.to(state.id).emit("room:state", state);
    });
    socket.on("room:control-request", () => {
      const state = rooms.requestControl(socket.id);
      if (state) io.to(state.id).emit("room:state", state);
    });
    const handleControlDecision = (action: RoomControlAction) => (payload: unknown) => {
      const parsed = roomControlTargetSchema.safeParse(payload);
      if (!parsed.success) return;
      const state = rooms.decideControl(socket.id, parsed.data.participantId, action);
      if (!state) return fail("Только Host может выдавать разрешения", "FORBIDDEN");
      io.to(state.id).emit("room:state", state);
    };
    socket.on("room:control-approve", handleControlDecision("approve"));
    socket.on("room:control-reject", handleControlDecision("reject"));
    socket.on("room:control-revoke", handleControlDecision("revoke"));

    socket.on("participant:update", (payload) => {
      if (!participantRate.allow(socket.id)) return;
      const parsed = participantUpdateSchema.safeParse(payload);
      if (!parsed.success) return;
      const participant = rooms.updateParticipant(socket.id, parsed.data);
      if (participant && socket.data.roomId)
        io.to(socket.data.roomId).emit("participant:update", participant);
    });

    socket.on("video:set-source", (payload) => {
      if (!videoRate.allow(socket.id)) return;
      const parsedPayload = videoSourceSelectionSchema.safeParse(payload);
      if (!parsedPayload.success) return;
      let source: VideoSource | null = null;
      if ("input" in parsedPayload.data) {
        source = parseSubmittedVideoUrl(parsedPayload.data.input);
        if (!source)
          return fail(
            "Нужна ссылка RUTUBE или прямая http(s)-ссылка на поддерживаемый видеофайл",
            "INVALID_VIDEO_URL",
          );
      } else if ("localFileName" in parsedPayload.data) {
        source = {
          provider: "html5",
          mode: "local",
          fileName: parsedPayload.data.localFileName,
        };
      } else {
        source = {
          provider: "html5",
          mode: "p2p-movie",
          ...parsedPayload.data.p2pMovie,
        };
      }
      if (!source)
        return fail("Некорректный источник видео", "INVALID_VIDEO_SOURCE");
      const video = rooms.setSource(socket.id, source);
      if (!video) return fail("Нет разрешения менять этот источник видео", "FORBIDDEN");
      if (socket.data.roomId) {
        streams.clear(socket.data.roomId);
        io.to(socket.data.roomId).emit("video:state", video);
        const state = rooms.get(socket.data.roomId);
        state?.participants.forEach((participant) =>
          io.to(socket.data.roomId!).emit("participant:update", participant),
        );
      }
    });

    socket.on("video:action", (payload) => {
      if (!videoRate.allow(socket.id)) return;
      const parsed = videoActionSchema.safeParse(payload);
      if (!parsed.success) return;
      if (!rooms.canControlPlayback(socket.id))
        return fail("Нет разрешения управлять воспроизведением", "FORBIDDEN");
      const video = rooms.updateVideo(
        socket.id,
        parsed.data.action,
        parsed.data.currentTime,
      );
      if (!video) return fail("Сначала выберите видео", "INVALID_VIDEO_STATE");
      if (socket.data.roomId)
        io.to(socket.data.roomId).emit("video:state", video);
    });

    socket.on("chat:send", (payload, ack) => {
      if (!chatRate.allow(socket.id))
        return ack({
          ok: false,
          error: "Слишком много сообщений. Подождите несколько секунд",
        });
      const parsed = chatSendSchema.safeParse(payload);
      if (!parsed.success)
        return ack({
          ok: false,
          error: "Сообщение должно содержать от 1 до 500 символов",
        });
      const message = rooms.addMessage(socket.id, parsed.data.text);
      if (!message || !socket.data.roomId)
        return ack({ ok: false, error: "Сначала войдите в комнату" });
      io.to(socket.data.roomId).emit("chat:message", message);
      ack({ ok: true, data: undefined });
    });

    socket.on("webrtc:offer", (payload) =>
      relayDescription("webrtc:offer", payload),
    );
    socket.on("webrtc:answer", (payload) =>
      relayDescription("webrtc:answer", payload),
    );
    socket.on("webrtc:ice-candidate", relayCandidate);
    socket.on("movie:offer", (payload) =>
      relayMovieDescription("movie:offer", payload),
    );
    socket.on("movie:answer", (payload) =>
      relayMovieDescription("movie:answer", payload),
    );
    socket.on("movie:ice-candidate", relayMovieCandidate);

    function relayDescription(
      event: "webrtc:offer" | "webrtc:answer",
      payload: unknown,
    ) {
      if (!descriptionRate.allow(socket.id)) return;
      const parsed = signalDescriptionSchema.safeParse(payload);
      if (!parsed.success || !canRelaySignal(rooms, socket.id, parsed.data.to))
        return;
      const outgoing: SignalDescription = { ...parsed.data, from: socket.id };
      if (event === "webrtc:offer")
        io.to(parsed.data.to).emit("webrtc:offer", outgoing);
      else io.to(parsed.data.to).emit("webrtc:answer", outgoing);
    }

    function relayCandidate(payload: unknown) {
      if (!iceCandidateRate.allow(socket.id)) return;
      const parsed = signalCandidateSchema.safeParse(payload);
      if (!parsed.success || !canRelaySignal(rooms, socket.id, parsed.data.to))
        return;
      const outgoing: SignalCandidate = { ...parsed.data, from: socket.id };
      io.to(parsed.data.to).emit("webrtc:ice-candidate", outgoing);
    }

    function relayMovieDescription(
      event: "movie:offer" | "movie:answer",
      payload: unknown,
    ) {
      if (!movieDescriptionRate.allow(socket.id)) return;
      const parsed = signalDescriptionSchema.safeParse(payload);
      if (!parsed.success || !canRelaySignal(rooms, socket.id, parsed.data.to))
        return;
      const outgoing: SignalDescription = { ...parsed.data, from: socket.id };
      if (event === "movie:offer")
        io.to(parsed.data.to).emit("movie:offer", outgoing);
      else io.to(parsed.data.to).emit("movie:answer", outgoing);
    }

    function relayMovieCandidate(payload: unknown) {
      if (!movieCandidateRate.allow(socket.id)) return;
      const parsed = signalCandidateSchema.safeParse(payload);
      if (!parsed.success || !canRelaySignal(rooms, socket.id, parsed.data.to))
        return;
      io.to(parsed.data.to).emit("movie:ice-candidate", {
        ...parsed.data,
        from: socket.id,
      });
    }

    function leaveCurrent() {
      const current = rooms.getBySocket(socket.id);
      const participantId = rooms.getParticipantId(socket.id);
      streams.closeParticipant(socket.id);
      const stopsHostMedia =
        current?.hostId === participantId &&
        current.video.source?.provider === "html5" &&
        (current.video.source.mode === "host-stream" ||
          current.video.source.mode === "p2p-movie");
      if (current && stopsHostMedia) {
        streams.clear(current.id);
        const stoppedVideo = rooms.clearSource(current.id, participantId ?? null);
        if (stoppedVideo) io.to(current.id).emit("video:state", stoppedVideo);
        socket
          .to(current.id)
          .emit("room:error", {
            code: "HOST_STREAM_STOPPED",
            message: current.video.source?.provider === "html5" && current.video.source.mode === "p2p-movie"
              ? "Host вышел из комнаты. P2P-передача фильма остановлена."
              : "Host вышел из комнаты. Трансляция фильма остановлена.",
          });
      }
      const result = rooms.leave(socket.id);
      if (!result) return;
      if (participantId) {
        const pending = pendingDisconnectLeaves.get(participantId);
        if (pending) { clearTimeout(pending.timer); pendingDisconnectLeaves.delete(participantId); }
      }
      if (!result.hostId) streams.clear(result.roomId);
      socket.leave(result.roomId);
      socket.data.roomId = undefined;
      socket.data.participantId = undefined;
      io.to(result.roomId).emit("participant:left", {
        participantId: result.participantId,
        hostId: result.hostId,
      });
      const state = rooms.get(result.roomId);
      if (state) io.to(result.roomId).emit("room:state", state);
    }

    socket.on("disconnect", () => {
      const disconnected = rooms.disconnect(socket.id);
      if (disconnected) {
        const { room, participant } = disconnected;
        streams.closeParticipant(socket.id);
        const timer = setTimeout(() => {
          pendingDisconnectLeaves.delete(participant.id);
          const current = rooms.get(room.id);
          const source = current?.video.source;
          if (current?.hostId === participant.id && source?.provider === "html5" && (source.mode === "host-stream" || source.mode === "p2p-movie")) {
            streams.clear(room.id);
            const stoppedVideo = rooms.clearSource(room.id, participant.id);
            if (stoppedVideo) io.to(room.id).emit("video:state", stoppedVideo);
            io.to(room.id).emit("room:error", { code: "HOST_STREAM_STOPPED", message: source.mode === "p2p-movie" ? "Host не переподключился. P2P-передача фильма остановлена." : "Host не переподключился. Трансляция фильма остановлена." });
          }
          const result = rooms.leaveParticipant(room.id, participant.id);
          if (!result) return;
          if (!result.hostId) streams.clear(room.id);
          io.to(room.id).emit("participant:left", { participantId: result.participantId, hostId: result.hostId });
          const next = rooms.get(room.id);
          if (next) io.to(room.id).emit("room:state", next);
        }, 30_000);
        pendingDisconnectLeaves.set(participant.id, { roomId: room.id, timer });
      }
      chatRate.clear(socket.id);
      participantRate.clear(socket.id);
      videoRate.clear(socket.id);
      descriptionRate.clear(socket.id);
      iceCandidateRate.clear(socket.id);
      movieDescriptionRate.clear(socket.id);
      movieCandidateRate.clear(socket.id);
    });
  });

  return { io, rooms, streams };
}
