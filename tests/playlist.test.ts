import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm, writeFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "socket.io";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { handleLocalMediaRequest } from "@/server/local-media-http";
import { LocalMediaRegistry, UnsupportedLocalMediaError, UNSUPPORTED_LOCAL_MEDIA_MESSAGE } from "@/server/local-media-registry";
import { HostMediaCatalog } from "@/server/host-media-catalog";
import type { HostFilePicker } from "@/server/host-file-picker";
import { RoomManager } from "@/server/room-manager";
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData, VideoSource } from "@/types/realtime";

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

describe("playlist room state", () => {
  it("lets Everyone add safe remote sources, keeps queue actions Host-only and starts from one authoritative revision", () => {
    const rooms = new RoomManager();
    const room = rooms.create("owner", "Owner");
    const credentials = rooms.getCredentials("owner")!;
    rooms.join(room.id, "guest", "Guest", credentials.roomToken);
    const remoteSource: VideoSource = { provider: "html5", mode: "url", url: "https://cdn.example.test/movie.mp4" };
    const queued = rooms.addRemotePlaylistItem("guest", "https://cdn.example.test/movie.mp4", remoteSource)!;
    const item = queued.playlist[0]!;
    expect(item).toMatchObject({ type: "remote", addedBy: rooms.getCredentials("guest")?.participantId, source: { type: "remote", input: remoteSource.url } });
    expect(rooms.playPlaylistItem("guest", item.id, remoteSource)).toBeNull();

    const started = rooms.playPlaylistItem("owner", item.id, remoteSource)!;
    const startState = rooms.get(room.id)!;
    expect(started.revision).toBe(1);
    expect(startState.currentPlaylistItemId).toBe(item.id);
    expect(startState.currentPlaylistPlaybackId).toMatch(/^[a-f0-9]{32}$/);
    expect(rooms.advancePlaylist("owner", item.id, startState.currentPlaylistPlaybackId!, null)?.video.revision).toBe(2);
  });

  it("keeps filesystem ownership with the original participant after Host transfer", () => {
    const rooms = new RoomManager();
    const room = rooms.create("owner", "Owner");
    const owner = rooms.getCredentials("owner")!;
    const guestId = rooms.join(room.id, "guest", "Guest", owner.roomToken)!.participantId;
    expect(rooms.isRoomOwner("owner")).toBe(true);
    expect(rooms.leave("owner")?.hostId).toBe(guestId);
    expect(rooms.isHost("guest")).toBe(true);
    expect(rooms.isRoomOwner("guest")).toBe(false);
    expect(rooms.getOwnerTokenForHost("guest")).toBeNull();
    expect(rooms.getCredentials("guest")?.ownerToken).toBeUndefined();
    expect(rooms.addLocalPlaylistItem("guest", { mediaId: "a".repeat(32), fileName: "movie.mp4", size: 10 })).toBeNull();
  });

  it("moves/removes/clears items without exposing server paths and invalidates stale ended events", () => {
    const rooms = new RoomManager();
    const room = rooms.create("owner", "Owner");
    const owner = rooms.getCredentials("owner")!;
    const guestId = rooms.join(room.id, "guest", "Guest", owner.roomToken)!.participantId;
    const first = rooms.addLocalPlaylistItem("owner", { mediaId: "b".repeat(32), fileName: "one.mp4", size: 10 })!.playlist[0]!;
    rooms.addLocalPlaylistItem("owner", { mediaId: "c".repeat(32), fileName: "two.mp4", size: 20 });
    rooms.addRemotePlaylistItem("owner", "https://cdn.example.test/three.mp4", { provider: "html5", mode: "url", url: "https://cdn.example.test/three.mp4" });
    const moved = rooms.movePlaylistItem("owner", first.id, "down")!;
    expect(moved.playlist.map((item) => item.title)).toEqual(["two.mp4", "one.mp4", "three.mp4"]);
    expect(JSON.stringify(moved)).not.toContain("absolutePath");
    const firstAgain = moved.playlist[1]!;
    const source: VideoSource = { provider: "html5", mode: "host-stream", fileName: "one.mp4", mediaId: "b".repeat(32), streamId: "stream" };
    rooms.playPlaylistItem("owner", firstAgain.id, source);
    const playbackId = rooms.get(room.id)!.currentPlaylistPlaybackId!;
    expect(rooms.getNextPlaylistItem(room.id, firstAgain.id, playbackId)?.title).toBe("three.mp4");
    const nextSource: VideoSource = { provider: "html5", mode: "url", url: "https://cdn.example.test/three.mp4" };
    const transition = rooms.advancePlaylist("owner", firstAgain.id, playbackId, nextSource)!;
    expect(transition.video.revision).toBe(2);
    expect(rooms.advancePlaylist("owner", firstAgain.id, playbackId, nextSource)).toBeNull();
    expect(rooms.removePlaylistItem("guest", firstAgain.id)).toBeNull();
    expect(rooms.clearPlaylist("guest")).toBeNull();
    expect(rooms.clearPlaylist("owner")?.playlist).toEqual([]);
    expect(rooms.get(room.id)?.video.source).toBeNull();
    expect(rooms.get(room.id)?.video.revision).toBe(3);
    expect(guestId).not.toBe(owner.participantId);
  });
});

describe("Owner-local HTTP media", () => {
  let directory: string;
  let moviePath: string;
  let bytes: Buffer;
  let rooms: RoomManager;
  let localMedia: LocalMediaRegistry;
  let catalog: HostMediaCatalog;
  let picker: HostFilePicker;
  let server: HttpServer;
  let baseUrl: string;
  const emit = vi.fn();
  const io = { to: () => ({ emit }) } as unknown as RealtimeServer;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "watch-local-media-"));
    moviePath = join(directory, "movie.mp4");
    bytes = Buffer.from(Array.from({ length: 257 }, (_, index) => index % 251));
    await writeFile(moviePath, bytes);
    rooms = new RoomManager();
    localMedia = new LocalMediaRegistry();
    catalog = new HostMediaCatalog(directory);
    picker = { pick: vi.fn().mockResolvedValue(null) };
    emit.mockClear();
    server = createServer((request, response) => { void handleLocalMediaRequest(request, response, { rooms, localMedia, catalog, picker, io }); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    await rm(directory, { recursive: true, force: true });
  });

  function createRoom() {
    const room = rooms.create("owner", "Owner");
    const ownerCredentials = rooms.getCredentials("owner")!;
    const guest = rooms.join(room.id, "guest", "Guest", ownerCredentials.roomToken)!;
    return {
      room,
      ownerToken: rooms.issueStreamToken("owner")!,
      guestToken: rooms.issueStreamToken("guest")!,
      guestId: guest.participantId,
      ownerCredentials,
    };
  }

  it("registers from an Owner-only path, derives metadata on the server, and never returns the path", async () => {
    const { room, ownerToken, guestToken } = createRoom();
    const endpoint = `${baseUrl}/api/rooms/${room.id}/owner-media/register`;
    const forbidden = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${guestToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: moviePath }) });
    expect(forbidden.status).toBe(403);
    const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${ownerToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: moviePath }) });
    const body = await response.json() as { item: { id: string; type: string; source: { mediaId: string; fileName: string; size: number } } };
    expect(response.status).toBe(200);
    expect(body.item).toMatchObject({ type: "local", source: { fileName: "movie.mp4", size: bytes.length } });
    expect(body.item.source.mediaId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect(JSON.stringify(body)).not.toContain(directory);
    expect(JSON.stringify(rooms.get(room.id))).not.toContain(directory);
    expect((await stat(moviePath)).size).toBe(body.item.source.size);
    expect(await localMedia.resolveForStream("another-room", body.item.source.mediaId)).toBeNull();
  });

  it("serves byte-identical GET ranges and HEAD, rejects invalid range and other-room tokens", async () => {
    const { room, ownerToken, guestToken } = createRoom();
    const registered = await localMedia.register(room.id, moviePath);
    const state = rooms.addLocalPlaylistItem("owner", registered)!;
    const item = state.playlist[0]!;
    rooms.playPlaylistItem("owner", item.id, { provider: "html5", mode: "host-stream", fileName: item.title, mediaId: registered.mediaId, streamId: "stream-1" });
    const endpoint = `${baseUrl}/api/rooms/${room.id}/media/${registered.mediaId}/stream?token=${guestToken}`;
    const response = await fetch(endpoint, { headers: { Range: "bytes=32-95" } });
    expect(response.status).toBe(206);
    expect(response.headers.get("content-range")).toBe(`bytes 32-95/${bytes.length}`);
    expect(response.headers.get("accept-ranges")).toBe("bytes");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(bytes.subarray(32, 96));
    const head = await fetch(endpoint, { method: "HEAD", headers: { Range: "bytes=0-7" } });
    expect(head.status).toBe(206);
    expect(head.headers.get("content-length")).toBe("8");
    expect(head.headers.get("content-range")).toBe(`bytes 0-7/${bytes.length}`);
    const invalid = await fetch(endpoint, { headers: { Range: "bytes=999-1000" } });
    expect(invalid.status).toBe(416);
    expect(invalid.headers.get("content-range")).toBe(`bytes */${bytes.length}`);
    const otherRoom = rooms.create("other-owner", "Other");
    const wrongRoom = await fetch(`${baseUrl}/api/rooms/${otherRoom.id}/media/${registered.mediaId}/stream?token=${ownerToken}`);
    expect(wrongRoom.status).toBe(401);
  });

  it("does not grant file access to a Guest after Host transfer and closes old-session transfers", async () => {
    const { room, ownerCredentials, guestToken, guestId } = createRoom();
    const guestStreamToken = guestToken;
    let closed = false;
    localMedia.track(room.id, "old-socket", { destroy: () => { closed = true; } });
    localMedia.closeParticipant("old-socket");
    expect(closed).toBe(true);

    rooms.leave("owner");
    expect(rooms.get(room.id)?.hostId).toBe(guestId);
    const endpoint = `${baseUrl}/api/rooms/${room.id}/owner-media/register`;
    const denied = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${guestStreamToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: moviePath }) });
    expect(denied.status).toBe(403);
    const ownerRecovery = rooms.join(room.id, "owner-return", "Owner", ownerCredentials.roomToken, { ownerToken: ownerCredentials.ownerToken });
    expect(ownerRecovery?.room.hostId).toBe(ownerRecovery?.participantId);
    expect(rooms.isRoomOwner("owner-return")).toBe(true);
  });

  it("rejects unsupported formats and marks removed or changed files unavailable", async () => {
    const { room } = createRoom();
    const unsupportedPath = join(directory, "movie.mkv");
    await writeFile(unsupportedPath, bytes);
    await expect(localMedia.register(room.id, unsupportedPath)).rejects.toBeInstanceOf(UnsupportedLocalMediaError);
    expect(UNSUPPORTED_LOCAL_MEDIA_MESSAGE).toBe("Этот формат браузер не может воспроизвести напрямую.");
    const registered = await localMedia.register(room.id, moviePath);
    await writeFile(moviePath, Buffer.from("changed-size"));
    expect(await localMedia.resolveForStream(room.id, registered.mediaId)).toBeNull();
    expect(await localMedia.resolveForStream(room.id, registered.mediaId)).toBeNull();
  });
});
