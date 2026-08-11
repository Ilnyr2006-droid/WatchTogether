import { randomBytes, timingSafeEqual } from "node:crypto";
import type { ChatMessage, Participant, RoomState, VideoSource, VideoState } from "@/types/realtime";
import { effectiveVideoTime } from "@/lib/video-sync";

type RoomRecord = RoomState;

export class RoomManager {
  private readonly rooms = new Map<string, RoomRecord>();
  private readonly socketRooms = new Map<string, string>();
  private readonly roomTokens = new Map<string, string>();
  private readonly streamTokens = new Map<string, { roomId: string; socketId: string }>();
  private readonly socketTokens = new Map<string, string>();

  create(socketId: string, username: string): RoomState {
    let id = "";
    do { id = randomBytes(5).toString("hex"); } while (this.rooms.has(id));
    const participant = this.participant(socketId, username);
    const room: RoomRecord = {
      id, hostId: socketId, participants: [participant], messages: [],
      video: { source: null, currentTime: 0, playing: false, updatedAt: Date.now() },
    };
    this.rooms.set(id, room);
    this.roomTokens.set(id, randomBytes(32).toString("base64url"));
    this.socketRooms.set(socketId, id);
    return this.snapshot(room);
  }

  join(roomId: string, socketId: string, username: string, roomToken: string): RoomState | null {
    const room = this.rooms.get(roomId);
    if (!room || !this.isRoomTokenValid(roomId, roomToken)) return null;
    const existing = room.participants.find((p) => p.socketId === socketId);
    if (!existing) room.participants.push(this.participant(socketId, username));
    this.socketRooms.set(socketId, roomId);
    return this.snapshot(room);
  }

  leave(socketId: string): { roomId: string; hostId: string | null } | null {
    const roomId = this.socketRooms.get(socketId);
    if (!roomId) return null;
    this.socketRooms.delete(socketId);
    const token = this.socketTokens.get(socketId);
    if (token) this.streamTokens.delete(token);
    this.socketTokens.delete(socketId);
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.participants = room.participants.filter((p) => p.socketId !== socketId);
    if (room.participants.length === 0) { this.rooms.delete(roomId); this.roomTokens.delete(roomId); return { roomId, hostId: null }; }
    if (room.hostId === socketId) room.hostId = room.participants[0].socketId;
    return { roomId, hostId: room.hostId };
  }

  getBySocket(socketId: string) { const id = this.socketRooms.get(socketId); return id ? this.rooms.get(id) : undefined; }
  get(roomId: string) { const room = this.rooms.get(roomId); return room ? this.snapshot(room) : null; }
  isHost(socketId: string) { return this.getBySocket(socketId)?.hostId === socketId; }
  hasParticipant(room: RoomRecord, socketId: string) { return room.participants.some((p) => p.socketId === socketId); }

  getRoomTokenForHost(socketId: string) {
    const room = this.getBySocket(socketId);
    return room?.hostId === socketId ? this.roomTokens.get(room.id) ?? null : null;
  }

  isRoomTokenValid(roomId: string, candidate: string) {
    const expected = this.roomTokens.get(roomId);
    if (!expected || typeof candidate !== "string") return false;
    const expectedBuffer = Buffer.from(expected);
    const candidateBuffer = Buffer.from(candidate);
    return expectedBuffer.length === candidateBuffer.length && timingSafeEqual(expectedBuffer, candidateBuffer);
  }

  issueStreamToken(socketId: string) {
    const room = this.getBySocket(socketId);
    if (!room) return null;
    const previous = this.socketTokens.get(socketId);
    if (previous) this.streamTokens.delete(previous);
    const token = randomBytes(32).toString("base64url");
    this.socketTokens.set(socketId, token);
    this.streamTokens.set(token, { roomId: room.id, socketId });
    return token;
  }

  authorizeStream(roomId: string, token: string) {
    const session = this.streamTokens.get(token);
    const room = this.rooms.get(roomId);
    if (!session || !room || session.roomId !== roomId || !this.hasParticipant(room, session.socketId)) return null;
    return { socketId: session.socketId, isHost: room.hostId === session.socketId };
  }

  clearSource(roomId: string) {
    const room = this.rooms.get(roomId);
    if (!room) return null;
    room.video = { source: null, currentTime: 0, playing: false, updatedAt: Date.now() };
    room.participants.forEach((participant) => { participant.ready = false; });
    return { ...room.video };
  }

  updateParticipant(socketId: string, patch: { muted?: boolean; ready?: boolean }): Participant | null {
    const room = this.getBySocket(socketId);
    const participant = room?.participants.find((p) => p.socketId === socketId);
    if (!participant) return null;
    if (typeof patch.muted === "boolean") participant.muted = patch.muted;
    if (typeof patch.ready === "boolean") participant.ready = patch.ready;
    return { ...participant };
  }

  setSource(socketId: string, source: VideoSource): VideoState | null {
    const room = this.getBySocket(socketId);
    if (!room || room.hostId !== socketId) return null;
    room.video = { source, currentTime: 0, playing: false, updatedAt: Date.now() };
    const isLocal = source.provider === "html5" && source.mode === "local";
    room.participants.forEach((participant) => { participant.ready = participant.socketId === socketId && !isLocal; });
    return { ...room.video };
  }

  updateVideo(socketId: string, action: "play" | "pause" | "seek" | "sync", currentTime: number): VideoState | null {
    const room = this.getBySocket(socketId);
    if (!room || room.hostId !== socketId || !room.video.source) return null;
    room.video.currentTime = currentTime;
    if (action === "play") room.video.playing = true;
    if (action === "pause") room.video.playing = false;
    room.video.updatedAt = Date.now();
    return { ...room.video };
  }

  addMessage(socketId: string, text: string): ChatMessage | null {
    const room = this.getBySocket(socketId);
    const sender = room?.participants.find((p) => p.socketId === socketId);
    if (!room || !sender) return null;
    const message = { id: randomBytes(8).toString("hex"), username: sender.username, text, timestamp: Date.now() };
    room.messages.push(message);
    if (room.messages.length > 100) room.messages.shift();
    return message;
  }

  getMessages(roomId: string) { return [...(this.rooms.get(roomId)?.messages ?? [])]; }

  private participant(socketId: string, username: string): Participant {
    return { socketId, username, muted: true, ready: false, joinedAt: Date.now(), connected: true };
  }

  private snapshot(room: RoomRecord): RoomState {
    return { id: room.id, hostId: room.hostId, participants: room.participants.map((p) => ({ ...p })), video: { ...room.video, currentTime: effectiveVideoTime(room.video), updatedAt: Date.now() }, messages: room.messages.map((message) => ({ ...message })) };
  }
}
