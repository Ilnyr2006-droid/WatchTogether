import { describe, expect, it } from "vitest";
import { RoomManager } from "@/server/room-manager";
import { canRelaySignal } from "@/server/signaling";
import { signalCandidateSchema, signalDescriptionSchema, videoSourceSelectionSchema } from "@/server/validation";

describe("signaling authorization and validation", () => {
  it("allows only different peers in the same room", () => {
    const rooms = new RoomManager();
    const first = rooms.create("sender", "Sender"); rooms.join(first.id, "target", "Target", rooms.getRoomTokenForHost("sender")!);
    rooms.create("outsider", "Outsider");
    expect(canRelaySignal(rooms, "sender", "target")).toBe(true);
    expect(canRelaySignal(rooms, "sender", "outsider")).toBe(false);
    expect(canRelaySignal(rooms, "sender", "sender")).toBe(false);
  });

  it("routes signaling only to the participant's current socket after reconnect", () => {
    const rooms = new RoomManager();
    const host = rooms.create("host-socket", "Host");
    const roomToken = rooms.getCredentials("host-socket")!.roomToken;
    const guestJoin = rooms.join(host.id, "guest-old", "Guest", roomToken)!;
    const guest = guestJoin.room.participants.find((person) => person.socketId === "guest-old")!;
    const credentials = rooms.getCredentials("guest-old")!;
    rooms.join(host.id, "guest-new", "Guest", roomToken, { participantId: guest.id, sessionToken: credentials.sessionToken });
    expect(canRelaySignal(rooms, "host-socket", "guest-old")).toBe(false);
    expect(canRelaySignal(rooms, "host-socket", "guest-new")).toBe(true);
    expect(rooms.get(host.id)?.participants).toHaveLength(2);
  });

  it("rejects oversized SDP and ICE payloads", () => {
    expect(signalDescriptionSchema.safeParse({ to: "peer", description: { type: "offer", sdp: "x".repeat(64_001) } }).success).toBe(false);
    expect(signalCandidateSchema.safeParse({ to: "peer", candidate: { candidate: "x".repeat(4_097) } }).success).toBe(false);
    expect(signalCandidateSchema.safeParse({ to: "peer", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } }).success).toBe(true);
  });

  it("accepts bounded P2P metadata and rejects malformed source ids", () => {
    const valid = { p2pMovie: { fileName: "movie.mp4", size: 10_000, duration: 120, mimeCodec: 'video/mp4; codecs="avc1.64001f,mp4a.40.2"', codecs: ["avc1.64001f", "mp4a.40.2"], width: 1920, height: 1080, sourceId: "a".repeat(32) } };
    expect(videoSourceSelectionSchema.safeParse(valid).success).toBe(true);
    expect(videoSourceSelectionSchema.safeParse({ p2pMovie: { ...valid.p2pMovie, sourceId: "../secret" } }).success).toBe(false);
  });
});
