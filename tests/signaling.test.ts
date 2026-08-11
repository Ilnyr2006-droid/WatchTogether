import { describe, expect, it } from "vitest";
import { RoomManager } from "@/server/room-manager";
import { canRelaySignal } from "@/server/signaling";
import { signalCandidateSchema, signalDescriptionSchema } from "@/server/validation";

describe("signaling authorization and validation", () => {
  it("allows only different peers in the same room", () => {
    const rooms = new RoomManager();
    const first = rooms.create("sender", "Sender"); rooms.join(first.id, "target", "Target", rooms.getRoomTokenForHost("sender")!);
    rooms.create("outsider", "Outsider");
    expect(canRelaySignal(rooms, "sender", "target")).toBe(true);
    expect(canRelaySignal(rooms, "sender", "outsider")).toBe(false);
    expect(canRelaySignal(rooms, "sender", "sender")).toBe(false);
  });

  it("rejects oversized SDP and ICE payloads", () => {
    expect(signalDescriptionSchema.safeParse({ to: "peer", description: { type: "offer", sdp: "x".repeat(64_001) } }).success).toBe(false);
    expect(signalCandidateSchema.safeParse({ to: "peer", candidate: { candidate: "x".repeat(4_097) } }).success).toBe(false);
    expect(signalCandidateSchema.safeParse({ to: "peer", candidate: { candidate: "candidate:1", sdpMid: "0", sdpMLineIndex: 0 } }).success).toBe(true);
  });
});
