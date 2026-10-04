import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ChatMessage, LocalMediaPublic, Participant, PlaylistItem, RoomControlAction, RoomControlMode, RoomState, VideoSource, VideoState } from "@/types/realtime";
import { effectiveVideoTime } from "@/lib/video-sync";

type RoomRecord = RoomState;
interface Binding { roomId: string; participantId: string }
interface JoinResult { room: RoomState; participantId: string; sessionToken: string; replacedSocketId: string | null }

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly socketBindings = new Map<string, Binding>();
  private readonly participantTokens = new Map<string, { roomId: string; token: string }>();
  private readonly roomTokens = new Map<string, string>();
  private readonly ownerTokens = new Map<string, string>();
  private readonly ownerParticipantIds = new Map<string, string>();
  private readonly streamTokens = new Map<string, { roomId: string; socketId: string }>();
  private readonly socketTokens = new Map<string, string>();

  create(socketId: string, username: string): RoomState {
    let id = "";
    do { id = randomBytes(5).toString("hex"); } while (this.rooms.has(id));
    const participant = this.makeParticipant(socketId, username);
    const room: RoomRecord = {
      id, hostId: participant.id, participants: [participant], messages: [],
      video: { source: null, currentTime: 0, playing: false, updatedAt: Date.now(), revision: 0, updatedBy: participant.id },
      controlMode: "everyone", controlRequests: [], approvedControllerIds: [],
      playlist: [], currentPlaylistItemId: null, currentPlaylistPlaybackId: null,
    };
    this.rooms.set(id, room);
    this.roomTokens.set(id, randomBytes(32).toString("base64url"));
    this.ownerTokens.set(id, randomBytes(32).toString("base64url"));
    this.ownerParticipantIds.set(id, participant.id);
    this.bind(socketId, room, participant);
    return this.snapshot(room);
  }

  join(roomId: string, socketId: string, username: string, roomToken: string, credentials: { ownerToken?: string; participantId?: string; sessionToken?: string } = {}): JoinResult | null {
    const room = this.rooms.get(roomId);
    if (!room || !this.isRoomTokenValid(roomId, roomToken)) return null;
    const currentBinding = this.socketBindings.get(socketId);
    if (currentBinding && currentBinding.roomId !== roomId) return null;
    if (currentBinding && credentials.participantId && currentBinding.participantId !== credentials.participantId) return null;
    let participant: Participant;
    let replacedSocketId: string | null = null;
    if (currentBinding && !credentials.participantId && !credentials.sessionToken) {
      participant = room.participants.find((item) => item.id === currentBinding.participantId)!;
      if (!participant) return null;
    } else if ((credentials.participantId || credentials.sessionToken) && credentials.participantId && credentials.sessionToken && this.isSessionValid(roomId, credentials.participantId, credentials.sessionToken)) {
      const existing = room.participants.find((item) => item.id === credentials.participantId);
      if (!existing) return null;
      participant = existing;
      replacedSocketId = existing.socketId && existing.socketId !== socketId ? existing.socketId : null;
      if (replacedSocketId) {
        this.socketBindings.delete(replacedSocketId);
        this.invalidateStreamToken(replacedSocketId);
      }
      participant.socketId = socketId;
      participant.connected = true;
      this.bind(socketId, room, participant);
    } else if (credentials.ownerToken && this.isOwnerTokenValid(roomId, credentials.ownerToken)) {
      const ownerId = this.ownerParticipantIds.get(roomId);
      participant = room.participants.find((item) => item.id === ownerId) ?? this.makeParticipant(socketId, username);
      if (!room.participants.some((item) => item.id === participant.id)) room.participants.push(participant);
      replacedSocketId = participant.socketId && participant.socketId !== socketId ? participant.socketId : null;
      if (replacedSocketId) {
        this.socketBindings.delete(replacedSocketId);
        this.invalidateStreamToken(replacedSocketId);
      }
      room.hostId = participant.id;
      participant.socketId = socketId;
      participant.connected = true;
      this.ownerParticipantIds.set(roomId, participant.id);
      this.bind(socketId, room, participant);
    } else {
      if (credentials.participantId || credentials.sessionToken) return null;
      participant = this.makeParticipant(socketId, username);
      room.participants.push(participant);
      this.bind(socketId, room, participant);
    }
    return { room: this.snapshot(room), participantId: participant.id, sessionToken: this.participantTokens.get(participant.id)!.token, replacedSocketId };
  }

  leave(socketId: string): { roomId: string; hostId: string | null; participantId: string } | null {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return null;
    this.socketBindings.delete(socketId);
    this.invalidateStreamToken(socketId);
    return this.removeParticipant(binding.roomId, binding.participantId);
  }

  disconnect(socketId: string): { room: RoomState; participant: Participant } | null {
    const binding = this.socketBindings.get(socketId);
    if (!binding) return null;
    const room = this.rooms.get(binding.roomId);
    const participant = room?.participants.find((item) => item.id === binding.participantId);
    if (!room || !participant || participant.socketId !== socketId) return null;
    this.socketBindings.delete(socketId);
    this.invalidateStreamToken(socketId);
    participant.connected = false;
    participant.socketId = null;
    participant.ready = false;
    return { room: this.snapshot(room), participant: { ...participant } };
  }

  leaveParticipant(roomId: string, participantId: string) { return this.removeParticipant(roomId, participantId); }

  getBySocket(socketId: string) { const binding = this.socketBindings.get(socketId); return binding ? this.rooms.get(binding.roomId) : undefined; }
  getParticipantId(socketId: string) { return this.socketBindings.get(socketId)?.participantId ?? null; }
  getSocketId(roomId: string, participantId: string) { return this.rooms.get(roomId)?.participants.find((p) => p.id === participantId)?.socketId ?? null; }
  getCredentials(socketId: string) {
    const participantId = this.getParticipantId(socketId);
    const binding = this.socketBindings.get(socketId);
    const session = participantId ? this.participantTokens.get(participantId) : null;
    const roomToken = binding ? this.roomTokens.get(binding.roomId) : null;
    const ownerToken = binding && this.ownerParticipantIds.get(binding.roomId) === participantId ? this.ownerTokens.get(binding.roomId) : null;
    if (!participantId || !session || !roomToken) return null;
    return { participantId, sessionToken: session.token, roomToken, ownerToken: ownerToken ?? undefined };
  }
  get(roomId: string) { const room = this.rooms.get(roomId); return room ? this.snapshot(room) : null; }
  isHost(socketId: string) { const room = this.getBySocket(socketId); return !!room && room.hostId === this.getParticipantId(socketId); }
  isRoomOwner(socketId: string) {
    const room = this.getBySocket(socketId);
    const participantId = this.getParticipantId(socketId);
    return !!room && !!participantId && this.ownerParticipantIds.get(room.id) === participantId;
  }
  hasParticipant(room: RoomRecord, socketId: string) { return room.participants.some((p) => p.connected && p.socketId === socketId); }
  canControlPlayback(socketId: string) {
    const room = this.getBySocket(socketId);
    const participantId = this.getParticipantId(socketId);
    return !!room && !!participantId && (room.hostId === participantId || room.controlMode === "everyone" || (room.controlMode === "approved" && room.approvedControllerIds.includes(participantId)));
  }
  getRoomTokenForHost(socketId: string) { return this.isHost(socketId) ? this.roomTokens.get(this.getBySocket(socketId)!.id) ?? null : null; }
  getOwnerTokenForHost(socketId: string) { return this.isRoomOwner(socketId) ? this.ownerTokens.get(this.getBySocket(socketId)!.id) ?? null : null; }

  isRoomTokenValid(roomId: string, candidate: string) { return this.safeEqual(this.roomTokens.get(roomId), candidate); }
  private isOwnerTokenValid(roomId: string, candidate: string) { return this.safeEqual(this.ownerTokens.get(roomId), candidate); }
  private isSessionValid(roomId: string, participantId: string, candidate: string) {
    const session = this.participantTokens.get(participantId);
    return session?.roomId === roomId && this.safeEqual(session.token, candidate);
  }
  private safeEqual(expected: string | undefined, candidate: unknown) {
    if (!expected || typeof candidate !== "string") return false;
    const left = Buffer.from(expected); const right = Buffer.from(candidate);
    return left.length === right.length && timingSafeEqual(left, right);
  }

  issueStreamToken(socketId: string) {
    const room = this.getBySocket(socketId);
    if (!room) return null;
    const existingToken = this.socketTokens.get(socketId);
    const existingSession = existingToken ? this.streamTokens.get(existingToken) : null;
    if (existingSession?.roomId === room.id && existingSession.socketId === socketId) return existingToken;
    this.invalidateStreamToken(socketId);
    const token = randomBytes(32).toString("base64url");
    this.socketTokens.set(socketId, token);
    this.streamTokens.set(token, { roomId: room.id, socketId });
    return token;
  }
  authorizeStream(roomId: string, token: string) {
    const session = this.streamTokens.get(token);
    const room = this.rooms.get(roomId);
    const binding = session ? this.socketBindings.get(session.socketId) : null;
    if (!session || !room || session.roomId !== roomId || !binding || !this.hasParticipant(room, session.socketId)) return null;
    return { socketId: session.socketId, participantId: binding.participantId, isHost: room.hostId === binding.participantId, isOwner: this.ownerParticipantIds.get(roomId) === binding.participantId };
  }

  clearSource(roomId: string, updatedBy: string | null = null) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.currentPlaylistItemId = null;
    room.currentPlaylistPlaybackId = null;
    room.video = { source: null, currentTime: 0, playing: false, updatedAt: Date.now(), revision: room.video.revision + 1, updatedBy };
    room.participants.forEach((participant) => { participant.ready = false; });
    return { ...room.video };
  }
  updateParticipant(socketId: string, patch: { muted?: boolean; ready?: boolean }): Participant | null {
    const room = this.getBySocket(socketId);
    const participant = room?.participants.find((p) => p.socketId === socketId && p.connected);
    if (!participant) return null;
    if (typeof patch.muted === "boolean") participant.muted = patch.muted;
    if (typeof patch.ready === "boolean") participant.ready = patch.ready;
    return { ...participant };
  }
  setControlMode(socketId: string, mode: RoomControlMode) {
    const room = this.getBySocket(socketId);
    if (!room || !this.isHost(socketId)) return null;
    room.controlMode = mode;
    if (mode !== "approved") room.controlRequests = [];
    return this.snapshot(room);
  }
  requestControl(socketId: string) {
    const room = this.getBySocket(socketId); const participantId = this.getParticipantId(socketId);
    if (!room || !participantId || this.isHost(socketId) || room.controlMode !== "approved") return null;
    if (!room.approvedControllerIds.includes(participantId) && !room.controlRequests.includes(participantId)) room.controlRequests.push(participantId);
    return this.snapshot(room);
  }
  decideControl(socketId: string, participantId: string, action: RoomControlAction) {
    const room = this.getBySocket(socketId);
    if (!room || room.controlMode !== "approved" || !this.isHost(socketId) || !room.participants.some((p) => p.id === participantId)) return null;
    if (action === "approve") {
      room.controlRequests = room.controlRequests.filter((id) => id !== participantId);
      if (!room.approvedControllerIds.includes(participantId)) room.approvedControllerIds.push(participantId);
    } else if (action === "reject") {
      room.controlRequests = room.controlRequests.filter((id) => id !== participantId);
    } else {
      room.approvedControllerIds = room.approvedControllerIds.filter((id) => id !== participantId);
    }
    return this.snapshot(room);
  }

  setSource(socketId: string, source: VideoSource): VideoState | null {
    const room = this.getBySocket(socketId); const participantId = this.getParticipantId(socketId);
    const restrictedSource = source.provider === "html5" && source.mode !== "url";
    if (!room || !participantId || !this.canControlPlayback(socketId) || (restrictedSource && !this.isHost(socketId))) return null;
    let currentItemId: string | null = null;
    const remoteInput = getRemoteInput(source);
    if (remoteInput) {
      let item = room.playlist.find((candidate) => candidate.type === "remote" && candidate.source.type === "remote" && candidate.source.input === remoteInput);
      if (!item) {
        item = makeRemotePlaylistItem(remoteInput, source, participantId);
        room.playlist.push(item);
      }
      currentItemId = item.id;
    }
    room.currentPlaylistItemId = currentItemId;
    room.currentPlaylistPlaybackId = currentItemId ? randomBytes(16).toString("hex") : null;
    this.applySource(room, source, participantId);
    const requiresClientFile = source.provider === "html5" && source.mode === "local";
    const streamsFromHost = source.provider === "html5" && source.mode === "p2p-movie";
    const streamsFromServer = source.provider === "html5" && source.mode === "host-stream" && !!source.mediaId;
    room.participants.forEach((participant) => {
      participant.ready = requiresClientFile || streamsFromHost || streamsFromServer
        ? false
        : participant.id === participantId || !streamsFromHost;
    });
    return { ...room.video };
  }

  addRemotePlaylistItem(socketId: string, input: string, source: VideoSource): RoomState | null {
    const room = this.getBySocket(socketId);
    const participantId = this.getParticipantId(socketId);
    const safeInput = getRemoteInput(source);
    if (!room || !participantId || !this.canControlPlayback(socketId) || !safeInput || input.length > 2048) return null;
    room.playlist.push(makeRemotePlaylistItem(safeInput, source, participantId));
    return this.snapshot(room);
  }

  addLocalPlaylistItem(socketId: string, media: LocalMediaPublic): RoomState | null {
    const room = this.getBySocket(socketId);
    const participantId = this.getParticipantId(socketId);
    if (!room || !participantId || !this.isRoomOwner(socketId)) return null;
    const item: PlaylistItem = {
      id: randomBytes(12).toString("hex"),
      type: "local",
      title: media.fileName,
      addedBy: participantId,
      addedAt: Date.now(),
      source: { type: "local", mediaId: media.mediaId, fileName: media.fileName, size: media.size },
    };
    room.playlist.push(item);
    return this.snapshot(room);
  }

  getPlaylistItem(roomId: string, itemId: string) {
    const item = this.rooms.get(roomId)?.playlist.find((candidate) => candidate.id === itemId);
    return item ? clonePlaylistItem(item) : null;
  }

  getNextPlaylistItem(roomId: string, currentItemId: string, playbackId: string) {
    const room = this.rooms.get(roomId);
    if (!room || room.currentPlaylistItemId !== currentItemId || room.currentPlaylistPlaybackId !== playbackId) return null;
    const index = room.playlist.findIndex((item) => item.id === currentItemId);
    return index >= 0 && index + 1 < room.playlist.length ? clonePlaylistItem(room.playlist[index + 1]!) : null;
  }

  playPlaylistItem(socketId: string, itemId: string, source: VideoSource): VideoState | null {
    const room = this.getBySocket(socketId);
    const participantId = this.getParticipantId(socketId);
    const item = room?.playlist.find((candidate) => candidate.id === itemId);
    if (!room || !participantId || !this.isHost(socketId) || !item || !sourceMatchesItem(item, source)) return null;
    room.currentPlaylistItemId = item.id;
    room.currentPlaylistPlaybackId = randomBytes(16).toString("hex");
    this.applySource(room, source, participantId);
    room.participants.forEach((participant) => { participant.ready = false; });
    return { ...room.video };
  }

  advancePlaylist(socketId: string, endedItemId: string, playbackId: string, nextSource: VideoSource | null): { video: VideoState; state: RoomState } | null {
    const room = this.getBySocket(socketId);
    const participantId = this.getParticipantId(socketId);
    const item = room?.playlist.find((candidate) => candidate.id === endedItemId);
    if (!room || !participantId || !this.isHost(socketId) || room.currentPlaylistItemId !== endedItemId || room.currentPlaylistPlaybackId !== playbackId || !item) return null;
    const index = room.playlist.findIndex((candidate) => candidate.id === endedItemId);
    const next = index >= 0 ? room.playlist[index + 1] : undefined;
    if (next) {
      if (!nextSource || !sourceMatchesItem(next, nextSource)) return null;
      room.currentPlaylistItemId = next.id;
      room.currentPlaylistPlaybackId = randomBytes(16).toString("hex");
      this.applySource(room, nextSource, participantId);
      room.participants.forEach((participant) => { participant.ready = false; });
    } else {
      const video = this.clearSource(room.id, participantId)!;
      return { video, state: this.snapshot(room) };
    }
    return { video: { ...room.video }, state: this.snapshot(room) };
  }

  removePlaylistItem(socketId: string, itemId: string): RoomState | null {
    const room = this.getBySocket(socketId);
    if (!room || !this.isHost(socketId)) return null;
    const index = room.playlist.findIndex((item) => item.id === itemId);
    if (index < 0) return null;
    const wasCurrent = room.currentPlaylistItemId === itemId;
    room.playlist.splice(index, 1);
    if (wasCurrent) this.clearSource(room.id, this.getParticipantId(socketId));
    return this.snapshot(room);
  }

  movePlaylistItem(socketId: string, itemId: string, direction: "up" | "down"): RoomState | null {
    const room = this.getBySocket(socketId);
    if (!room || !this.isHost(socketId)) return null;
    const index = room.playlist.findIndex((item) => item.id === itemId);
    const targetIndex = index + (direction === "up" ? -1 : 1);
    if (index < 0 || targetIndex < 0 || targetIndex >= room.playlist.length) return null;
    [room.playlist[index], room.playlist[targetIndex]] = [room.playlist[targetIndex]!, room.playlist[index]!];
    return this.snapshot(room);
  }

  clearPlaylist(socketId: string): RoomState | null {
    const room = this.getBySocket(socketId);
    if (!room || !this.isHost(socketId)) return null;
    room.playlist = [];
    if (room.currentPlaylistItemId !== null || room.video.source !== null) this.clearSource(room.id, this.getParticipantId(socketId));
    return this.snapshot(room);
  }

  private applySource(room: RoomRecord, source: VideoSource, participantId: string) {
    room.video = { source, currentTime: 0, playing: false, updatedAt: Date.now(), revision: room.video.revision + 1, updatedBy: participantId };
  }

  /* kept below with the ordinary video state mutation path */
  updateVideo(socketId: string, action: "play" | "pause" | "seek" | "sync", currentTime: number): VideoState | null {
    const room = this.getBySocket(socketId); const participantId = this.getParticipantId(socketId);
    if (!room || !participantId || !room.video.source || !this.canControlPlayback(socketId)) return null;
    room.video.currentTime = currentTime;
    if (action === "play") room.video.playing = true;
    if (action === "pause") room.video.playing = false;
    room.video.updatedAt = Date.now(); room.video.updatedBy = participantId; room.video.revision += 1;
    return { ...room.video };
  }
  addMessage(socketId: string, text: string): ChatMessage | null {
    const room = this.getBySocket(socketId); const senderId = this.getParticipantId(socketId);
    const sender = room?.participants.find((p) => p.id === senderId && p.connected);
    if (!room || !sender) return null;
    const message = { id: randomBytes(8).toString("hex"), username: sender.username, text, timestamp: Date.now() };
    room.messages.push(message); if (room.messages.length > 100) room.messages.shift();
    return message;
  }
  getMessages(roomId: string) { return [...(this.rooms.get(roomId)?.messages ?? [])]; }

  private makeParticipant(socketId: string, username: string): Participant {
    const id = randomBytes(16).toString("hex");
    this.participantTokens.set(id, { roomId: "", token: randomBytes(32).toString("base64url") });
    return { id, socketId, username, muted: true, ready: false, joinedAt: Date.now(), connected: true };
  }
  private bind(socketId: string, room: RoomRecord, participant: Participant) {
    this.socketBindings.set(socketId, { roomId: room.id, participantId: participant.id });
    const credentials = this.participantTokens.get(participant.id);
    if (credentials) credentials.roomId = room.id;
  }
  private removeParticipant(roomId: string, participantId: string) {
    const room = this.rooms.get(roomId); if (!room) return null;
    const participant = room.participants.find((item) => item.id === participantId); if (!participant) return null;
    if (participant.socketId) { this.socketBindings.delete(participant.socketId); this.invalidateStreamToken(participant.socketId); }
    room.participants = room.participants.filter((item) => item.id !== participantId);
    this.participantTokens.delete(participantId);
    room.controlRequests = room.controlRequests.filter((id) => id !== participantId);
    room.approvedControllerIds = room.approvedControllerIds.filter((id) => id !== participantId);
    if (room.participants.length === 0) {
      this.rooms.delete(roomId); this.roomTokens.delete(roomId); this.ownerTokens.delete(roomId); this.ownerParticipantIds.delete(roomId);
      return { roomId, hostId: null, participantId };
    }
    if (room.hostId === participantId) room.hostId = (room.participants.find((item) => item.connected) ?? room.participants[0]).id;
    return { roomId, hostId: room.hostId, participantId };
  }
  private invalidateStreamToken(socketId: string) {
    const token = this.socketTokens.get(socketId); if (token) this.streamTokens.delete(token);
    this.socketTokens.delete(socketId);
  }
  private snapshot(room: RoomRecord): RoomState {
    const now = Date.now();
    return { ...room, participants: room.participants.map((p) => ({ ...p })), video: { ...room.video, currentTime: effectiveVideoTime(room.video, now), updatedAt: now }, controlRequests: [...room.controlRequests], approvedControllerIds: [...room.approvedControllerIds], messages: room.messages.map((message) => ({ ...message })), playlist: room.playlist.map(clonePlaylistItem) };
  }
}

function clonePlaylistItem(item: PlaylistItem): PlaylistItem {
  return item.type === "remote"
    ? { ...item, source: { ...item.source } }
    : { ...item, source: { ...item.source } };
}

function getRemoteInput(source: VideoSource): string | null {
  if (source.provider === "html5" && source.mode === "url") return source.url;
  if (source.provider === "rutube") {
    const url = new URL(source.originalUrl);
    if (source.accessKey) url.searchParams.set("p", source.accessKey);
    return url.toString();
  }
  return null;
}

function makeRemotePlaylistItem(input: string, source: VideoSource, participantId: string): PlaylistItem {
  let title = "Видео по URL";
  if (source.provider === "rutube") title = `RUTUBE · ${source.videoId}`;
  else if (source.provider === "html5" && source.mode === "url") {
    const url = new URL(source.url);
    const lastPart = url.pathname.split("/").filter(Boolean).at(-1);
    try { title = lastPart ? decodeURIComponent(lastPart).slice(0, 120) : url.hostname; }
    catch { title = url.hostname; }
  }
  return { id: randomBytes(12).toString("hex"), type: "remote", title, addedBy: participantId, addedAt: Date.now(), source: { type: "remote", input } };
}

function sourceMatchesItem(item: PlaylistItem, source: VideoSource) {
  if (item.source.type === "local") return source.provider === "html5" && source.mode === "host-stream" && source.mediaId === item.source.mediaId;
  return getRemoteInput(source) === item.source.input;
}
