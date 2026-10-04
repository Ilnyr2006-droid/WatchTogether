import { describe, expect, it, vi } from "vitest";
import { effectiveVideoTime } from "@/lib/video-sync";
import { RoomManager } from "@/server/room-manager";

describe("RoomManager", () => {
  it("creates a stable participant identity separate from the socket id", () => {
    const manager = new RoomManager();
    const room = manager.create("host-socket", "Host");
    const credentials = manager.getCredentials("host-socket")!;
    expect(room.id).toMatch(/^[a-z0-9]{10}$/);
    expect(room.hostId).toBe(credentials.participantId);
    expect(room.participants[0]).toMatchObject({ id: credentials.participantId, socketId: "host-socket", connected: true });
    expect(credentials.sessionToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it("rebinds a reconnected participant without duplicating it", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const invite = manager.getCredentials("host")!;
    const guestJoin = manager.join(room.id, "guest-old", "Guest", invite.roomToken)!;
    const guest = guestJoin.room.participants.find((person) => person.socketId === "guest-old")!;
    const returnedGuest = manager.getCredentials("guest-old")!;
    manager.disconnect("guest-old");
    expect(manager.get(room.id)?.participants.find((person) => person.id === guest.id)?.connected).toBe(false);
    const rejoined = manager.join(room.id, "guest-new", "Guest", invite.roomToken, { participantId: returnedGuest.participantId!, sessionToken: returnedGuest.sessionToken })!;
    expect(rejoined.replacedSocketId).toBeNull();
    expect(rejoined.room.participants.filter((person) => person.id === guest.id)).toHaveLength(1);
    expect(rejoined.room.participants.find((person) => person.id === guest.id)).toMatchObject({ socketId: "guest-new", connected: true });
  });

  it("replaces a live old socket when the same session attaches elsewhere", () => {
    const manager = new RoomManager();
    const room = manager.create("owner-old", "Owner");
    const auth = manager.getCredentials("owner-old")!;
    const oldStreamToken = manager.issueStreamToken("owner-old")!;
    expect(manager.authorizeStream(room.id, oldStreamToken)).not.toBeNull();
    const joined = manager.join(room.id, "owner-new", "Owner", auth.roomToken, { participantId: auth.participantId!, sessionToken: auth.sessionToken })!;
    expect(joined.replacedSocketId).toBe("owner-old");
    expect(joined.room.hostId).toBe(auth.participantId);
    expect(joined.room.participants).toHaveLength(1);
    expect(manager.getBySocket("owner-old")).toBeUndefined();
    expect(manager.authorizeStream(room.id, oldStreamToken)).toBeNull();
  });

  it("restores the original Host from the invite even after the session credential expires", () => {
    const manager = new RoomManager();
    const room = manager.create("owner", "Owner");
    const ownerCredentials = manager.getCredentials("owner")!;
    const guest = manager.join(room.id, "guest", "Guest", ownerCredentials.roomToken)!;
    manager.leave("owner");
    expect(manager.get(room.id)?.hostId).toBe(guest.participantId);
    const returned = manager.join(room.id, "owner-returned", "Owner", ownerCredentials.roomToken, { ownerToken: ownerCredentials.ownerToken })!;
    expect(returned.room.hostId).toBe(returned.participantId);
    expect(returned.room.participants.filter((person) => person.id === returned.participantId)).toHaveLength(1);
    expect(returned.room.participants).toHaveLength(2);
  });

  it("does not allow a removed participant's expired session to rejoin as a duplicate", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const roomToken = manager.getCredentials("host")!.roomToken;
    const joined = manager.join(room.id, "guest", "Guest", roomToken)!;
    const credentials = manager.getCredentials("guest")!;
    manager.leave("guest");
    expect(manager.join(room.id, "guest-returned", "Guest", roomToken, {
      participantId: credentials.participantId,
      sessionToken: credentials.sessionToken,
    })).toBeNull();
    expect(manager.get(room.id)?.participants).toHaveLength(1);
    expect(joined.participantId).toBe(credentials.participantId);
  });

  it("transfers host role and deletes an empty room on explicit leave", () => {
    const manager = new RoomManager();
    const room = manager.create("first", "First");
    const token = manager.getCredentials("first")!.roomToken;
    const second = manager.join(room.id, "second", "Second", token)!.room.participants.find((person) => person.socketId === "second")!;
    expect(manager.leave("first")).toEqual({ roomId: room.id, hostId: second.id, participantId: room.hostId });
    expect(manager.get(room.id)?.hostId).toBe(second.id);
    expect(manager.leave("second")).toMatchObject({ roomId: room.id, hostId: null });
    expect(manager.get(room.id)).toBeNull();
  });

  it("allows every participant to control URL and RUTUBE playback in Everyone mode", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.getCredentials("host")!.roomToken;
    manager.join(room.id, "guest", "Guest", token);
    expect(room.controlMode).toBe("everyone");
    expect(manager.canControlPlayback("guest")).toBe(true);
    expect(manager.setSource("guest", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" })?.source).toMatchObject({ mode: "url" });
    expect(manager.updateVideo("guest", "play", 12)?.playing).toBe(true);
    expect(manager.updateVideo("guest", "pause", 12)?.playing).toBe(false);
    expect(manager.updateVideo("guest", "seek", 18)?.currentTime).toBe(18);
    expect(manager.setSource("guest", { provider: "rutube", videoId: "7716bd3e665725c3c008ae7ab4ff02e2", accessKey: null, originalUrl: "https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/" })?.source).toMatchObject({ provider: "rutube" });
  });

  it("restricts playback and shared URL changes to Host in Host only mode", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.getCredentials("host")!.roomToken;
    manager.join(room.id, "guest", "Guest", token);
    manager.setSource("host", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" });
    manager.setControlMode("host", "host-only");
    expect(manager.canControlPlayback("host")).toBe(true);
    expect(manager.canControlPlayback("guest")).toBe(false);
    expect(manager.updateVideo("guest", "play", 13)).toBeNull();
    expect(manager.setSource("guest", { provider: "html5", mode: "url", url: "https://example.com/other.mp4" })).toBeNull();
    expect(manager.updateVideo("host", "play", 13)?.playing).toBe(true);
    expect(manager.setSource("host", { provider: "html5", mode: "url", url: "https://example.com/host.mp4" })?.source).toMatchObject({ mode: "url" });
  });

  it("supports Ask control request, approve, reject, and immediate revoke by participantId", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.getCredentials("host")!.roomToken;
    const guestJoin = manager.join(room.id, "guest", "Guest", token)!;
    const guest = guestJoin.room.participants.find((person) => person.socketId === "guest")!;
    manager.setSource("host", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" });
    expect(manager.setControlMode("host", "approved")?.controlMode).toBe("approved");
    expect(manager.canControlPlayback("host")).toBe(true);
    expect(manager.canControlPlayback("guest")).toBe(false);
    expect(manager.requestControl("guest")?.controlRequests).toContain(guest.id);
    expect(manager.updateVideo("guest", "play", 13)).toBeNull();
    expect(manager.decideControl("host", guest.id, "approve")?.approvedControllerIds).toContain(guest.id);
    expect(manager.canControlPlayback("guest")).toBe(true);
    expect(manager.setSource("guest", { provider: "html5", mode: "url", url: "https://example.com/guest.mp4" })?.updatedBy).toBe(guest.id);
    expect(manager.updateVideo("guest", "play", 13)?.updatedBy).toBe(guest.id);
    expect(manager.decideControl("host", guest.id, "revoke")?.approvedControllerIds).toHaveLength(0);
    expect(manager.canControlPlayback("guest")).toBe(false);
    expect(manager.updateVideo("guest", "pause", 13)).toBeNull();
    expect(manager.setSource("guest", { provider: "rutube", videoId: "7716bd3e665725c3c008ae7ab4ff02e2", accessKey: null, originalUrl: "https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/" })).toBeNull();
    expect(manager.requestControl("guest")?.controlRequests).toContain(guest.id);
    expect(manager.decideControl("host", guest.id, "reject")?.controlRequests).toHaveLength(0);
    expect(manager.canControlPlayback("host")).toBe(true);
  });

  it("retains approved grants across modes but clears pending requests", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.getCredentials("host")!.roomToken;
    const guestA = manager.join(room.id, "guest-a", "Guest A", token)!.participantId;
    const guestB = manager.join(room.id, "guest-b", "Guest B", token)!.participantId;

    manager.setControlMode("host", "approved");
    manager.requestControl("guest-a");
    manager.decideControl("host", guestA, "approve");
    manager.requestControl("guest-b");
    expect(manager.get(room.id)?.controlRequests).toContain(guestB);

    const hostOnly = manager.setControlMode("host", "host-only")!;
    expect(hostOnly.controlRequests).toEqual([]);
    expect(hostOnly.approvedControllerIds).toContain(guestA);
    expect(manager.canControlPlayback("guest-a")).toBe(false);

    const approvedAgain = manager.setControlMode("host", "approved")!;
    expect(approvedAgain.approvedControllerIds).toContain(guestA);
    expect(approvedAgain.controlRequests).toEqual([]);
    expect(manager.canControlPlayback("guest-a")).toBe(true);
  });

  it("rejects Guest mode changes and always keeps host-stream sources Host-only", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.getCredentials("host")!.roomToken;
    manager.join(room.id, "guest", "Guest", token);
    expect(manager.setControlMode("guest", "host-only")).toBeNull();
    expect(manager.get(room.id)?.controlMode).toBe("everyone");
    const hostStream = { provider: "html5", mode: "host-stream", fileName: "movie.mp4", streamId: "stream-id" } as const;
    expect(manager.setSource("guest", hostStream)).toBeNull();
    expect(manager.setSource("guest", { provider: "html5", mode: "local", fileName: "private.mp4" })).toBeNull();
    expect(manager.setSource("guest", { provider: "html5", mode: "p2p-movie", fileName: "private.mp4", size: 1, duration: 1, mimeCodec: "video/mp4", codecs: ["avc1"], width: null, height: null, sourceId: "a".repeat(32) })).toBeNull();
    expect(manager.setSource("host", hostStream)?.source).toMatchObject({ mode: "host-stream" });
  });

  it("persists RUTUBE, chat and authoritative state for late participants", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const credentials = manager.getCredentials("host")!;
    manager.setSource("host", { provider: "rutube", videoId: "7716bd3e665725c3c008ae7ab4ff02e2", accessKey: null, originalUrl: "https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/" });
    manager.updateVideo("host", "pause", 42);
    const latestRevision = manager.get(room.id)!.video.revision;
    manager.addMessage("host", "Saved in memory");
    const joined = manager.join(room.id, "guest", "Guest", credentials.roomToken)!.room;
    expect(joined.video.source).toMatchObject({ provider: "rutube", videoId: "7716bd3e665725c3c008ae7ab4ff02e2" });
    expect(joined.video.currentTime).toBe(42);
    expect(joined.video.revision).toBe(latestRevision);
    expect(joined.video.updatedBy).toBe(credentials.participantId);
    expect(joined.messages[0].text).toBe("Saved in memory");
  });

  it("increments video revision for source, playback, sync and clear mutations", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const participantId = manager.getCredentials("host")!.participantId!;
    let revision = room.video.revision;
    expect(revision).toBe(0);
    const source = { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" } as const;
    expect(manager.setSource("host", source)?.revision).toBe(++revision);
    for (const action of ["play", "pause", "seek", "sync"] as const) {
      const state = manager.updateVideo("host", action, 21);
      expect(state?.revision).toBe(++revision);
      expect(state?.updatedBy).toBe(participantId);
    }
    expect(manager.clearSource(room.id, participantId)?.revision).toBe(++revision);
    expect(manager.get(room.id)?.video.updatedBy).toBe(participantId);
  });

  it("rebases snapshot playhead and timestamp without changing video revision", () => {
    vi.useFakeTimers();
    try {
      vi.setSystemTime(10_000);
      const manager = new RoomManager();
      const room = manager.create("host", "Host");
      manager.setSource("host", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" });
      manager.updateVideo("host", "play", 20);

      vi.setSystemTime(15_000);
      const lateJoinSnapshot = manager.get(room.id)!;
      expect(lateJoinSnapshot.video).toMatchObject({ currentTime: 25, updatedAt: 15_000, playing: true, revision: 2 });
      expect(effectiveVideoTime(lateJoinSnapshot.video, 15_000)).toBe(25);

      vi.setSystemTime(17_000);
      const laterSnapshot = manager.get(room.id)!;
      expect(laterSnapshot.video).toMatchObject({ currentTime: 27, updatedAt: 17_000, revision: 2 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("serializes rapid actions from different participants into one final authoritative state", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const credentials = manager.getCredentials("host")!;
    manager.setSource("host", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" });
    const guest = manager.join(room.id, "guest", "Guest", credentials.roomToken)!.room.participants.find((person) => person.socketId === "guest")!;
    const play = manager.updateVideo("host", "play", 10)!;
    const pause = manager.updateVideo("guest", "pause", 14)!;
    const seek = manager.updateVideo("host", "seek", 27)!;
    expect([play.revision, pause.revision, seek.revision]).toEqual([2, 3, 4]);
    expect(manager.get(room.id)?.video).toMatchObject({ revision: 4, currentTime: 27, playing: false, updatedBy: credentials.participantId });
    expect(guest.id).not.toBe(credentials.participantId);
  });

  it("authorizes stream tokens only while their socket remains connected", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.issueStreamToken("host")!;
    expect(manager.authorizeStream(room.id, token)).toMatchObject({ socketId: "host", participantId: room.hostId, isHost: true });
    manager.disconnect("host");
    expect(manager.authorizeStream(room.id, token)).toBeNull();
  });

  it("reuses the stream token when room join is repeated on the same active socket", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const auth = manager.getCredentials("host")!;
    const first = manager.issueStreamToken("host")!;
    const repeatedJoin = manager.join(room.id, "host", "Host", auth.roomToken)!;
    expect(repeatedJoin.participantId).toBe(auth.participantId);
    expect(manager.issueStreamToken("host")).toBe(first);
    expect(manager.authorizeStream(room.id, first)).not.toBeNull();

    const takeover = manager.join(room.id, "host-reloaded", "Host", auth.roomToken, {
      participantId: auth.participantId!,
      sessionToken: auth.sessionToken,
    })!;
    expect(takeover.replacedSocketId).toBe("host");
    expect(manager.authorizeStream(room.id, first)).toBeNull();
    expect(manager.issueStreamToken("host-reloaded")).not.toBe(first);
  });

  it("requires the cryptographic room token and session secret", () => {
    const manager = new RoomManager(); const room = manager.create("host", "Host");
    const auth = manager.getCredentials("host")!;
    expect(auth.roomToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(manager.join(room.id, "attacker", "Attacker", "x".repeat(43))).toBeNull();
    expect(manager.join(room.id, "attacker", "Attacker", auth.roomToken, { participantId: auth.participantId!, sessionToken: "x".repeat(43) })).toBeNull();
    expect(manager.join(room.id, "guest", "Guest", auth.roomToken)?.room.participants).toHaveLength(2);
  });
});
