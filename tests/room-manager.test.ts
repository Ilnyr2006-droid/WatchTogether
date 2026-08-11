import { describe, expect, it } from "vitest";
import { RoomManager } from "@/server/room-manager";

describe("RoomManager", () => {
  it("creates a room and makes its creator host", () => {
    const manager = new RoomManager();
    const room = manager.create("host-socket", "Host");
    expect(room.id).toMatch(/^[a-z0-9]{10}$/);
    expect(room.hostId).toBe("host-socket");
    expect(room.participants).toHaveLength(1);
  });

  it("transfers host role and deletes an empty room", () => {
    const manager = new RoomManager();
    const room = manager.create("first", "First");
    manager.join(room.id, "second", "Second", manager.getRoomTokenForHost("first")!);
    expect(manager.leave("first")).toEqual({ roomId: room.id, hostId: "second" });
    expect(manager.get(room.id)?.hostId).toBe("second");
    expect(manager.leave("second")).toEqual({ roomId: room.id, hostId: null });
    expect(manager.get(room.id)).toBeNull();
  });

  it("only allows the host to change playback", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    manager.join(room.id, "guest", "Guest", manager.getRoomTokenForHost("host")!);
    expect(manager.setSource("guest", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" })).toBeNull();
    manager.setSource("host", { provider: "html5", mode: "url", url: "https://example.com/movie.mp4" });
    expect(manager.updateVideo("guest", "play", 12)).toBeNull();
    expect(manager.updateVideo("host", "play", 12)?.playing).toBe(true);
  });

  it("stores a RUTUBE provider and returns current state to a late participant", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    manager.setSource("host", { provider: "rutube", videoId: "7716bd3e665725c3c008ae7ab4ff02e2", accessKey: null, originalUrl: "https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/" });
    manager.updateVideo("host", "pause", 42);
    const joined = manager.join(room.id, "guest", "Guest", manager.getRoomTokenForHost("host")!);
    expect(joined?.video.source).toMatchObject({ provider: "rutube", videoId: "7716bd3e665725c3c008ae7ab4ff02e2" });
    expect(joined?.video.currentTime).toBe(42);
  });

  it("includes in-memory chat history in a room snapshot", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    manager.addMessage("host", "Saved in memory");
    expect(manager.join(room.id, "guest", "Guest", manager.getRoomTokenForHost("host")!)?.messages[0].text).toBe("Saved in memory");
  });

  it("authorizes stream tokens only while their participant remains in that room", () => {
    const manager = new RoomManager();
    const room = manager.create("host", "Host");
    const token = manager.issueStreamToken("host")!;
    expect(manager.authorizeStream(room.id, token)).toEqual({ socketId: "host", isHost: true });
    manager.leave("host");
    expect(manager.authorizeStream(room.id, token)).toBeNull();
  });

  it("requires the cryptographic room token", () => {
    const manager = new RoomManager(); const room = manager.create("host", "Host");
    const token = manager.getRoomTokenForHost("host")!;
    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(manager.join(room.id, "attacker", "Attacker", "x".repeat(43))).toBeNull();
    expect(manager.join(room.id, "guest", "Guest", token)?.participants).toHaveLength(2);
  });
});
