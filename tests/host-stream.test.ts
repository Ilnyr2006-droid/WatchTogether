import { createServer, type Server as HttpServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Server } from "socket.io";
import { handleHostStreamRequest } from "@/server/host-stream-http";
import { HostStreamRegistry, UNSUPPORTED_MEDIA_MESSAGE } from "@/server/host-stream-registry";
import { HostMediaCatalog } from "@/server/host-media-catalog";
import type { HostFilePicker } from "@/server/host-file-picker";
import { RoomManager } from "@/server/room-manager";
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from "@/types/realtime";

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

describe("protected host file streaming", () => {
  let directory: string; let moviePath: string; let rooms: RoomManager; let streams: HostStreamRegistry; let media: HostMediaCatalog; let picker: HostFilePicker;
  let server: HttpServer; let baseUrl: string; const emit = vi.fn(); const io = { to: () => ({ emit }) } as unknown as RealtimeServer;

  beforeEach(async () => {
    directory = await mkdtemp(join(tmpdir(), "watch-stream-")); moviePath = join(directory, "movie.mp4");
    await writeFile(moviePath, Buffer.from("0123456789"));
    rooms = new RoomManager(); streams = new HostStreamRegistry(); media = new HostMediaCatalog(directory); picker = { pick: vi.fn().mockResolvedValue(null) }; emit.mockClear();
    server = createServer((request, response) => { void handleHostStreamRequest(request, response, { rooms, streams, media, picker, io }); });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve)); baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });

  afterEach(async () => { await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve())); await rm(directory, { recursive: true, force: true }); });

  function createProtectedRoom() {
    const room = rooms.create("host", "Host"); const roomToken = rooms.getRoomTokenForHost("host")!;
    rooms.join(room.id, "guest", "Guest", roomToken);
    return { room, hostToken: rooms.issueStreamToken("host")!, guestToken: rooms.issueStreamToken("guest")! };
  }

  it("lists only media-directory files for Host and never accepts a filesystem path", async () => {
    const { room, hostToken, guestToken } = createProtectedRoom(); const endpoint = `${baseUrl}/api/rooms/${room.id}/host-stream`;
    expect((await fetch(`${endpoint}/files`, { headers: { Authorization: `Bearer ${guestToken}` } })).status).toBe(403);
    const catalog = await (await fetch(`${endpoint}/files`, { headers: { Authorization: `Bearer ${hostToken}` } })).json() as { files: { id: string; fileName: string }[] };
    expect(catalog.files).toHaveLength(1); expect(catalog.files[0].fileName).toBe("movie.mp4"); expect(JSON.stringify(catalog)).not.toContain(directory);
    const traversal = await fetch(`${endpoint}/select`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ path: "../../etc/passwd" }) });
    expect(traversal.status).toBe(400);
    const selected = await fetch(`${endpoint}/select`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ fileId: catalog.files[0].id }) });
    expect(selected.status).toBe(200); expect(rooms.get(room.id)?.video.source).toMatchObject({ mode: "host-stream", fileName: "movie.mp4" });
    expect(JSON.stringify(rooms.get(room.id))).not.toContain(directory);
  });

  it("streams to a joined guest with correct 206 and 416 headers", async () => {
    const { room, guestToken } = createProtectedRoom(); const file = await streams.register(room.id, moviePath);
    rooms.setSource("host", { provider: "html5", mode: "host-stream", fileName: file.fileName, streamId: file.streamId });
    const endpoint = `${baseUrl}/api/rooms/${room.id}/stream?token=${guestToken}`;
    const response = await fetch(endpoint, { headers: { Range: "bytes=2-5" } });
    expect(response.status).toBe(206); expect(response.headers.get("content-type")).toBe("video/mp4"); expect(response.headers.get("content-length")).toBe("4");
    expect(response.headers.get("content-range")).toBe("bytes 2-5/10"); expect(response.headers.get("accept-ranges")).toBe("bytes"); expect(await response.text()).toBe("2345");
    const invalid = await fetch(endpoint, { headers: { Range: "bytes=20-30" } }); expect(invalid.status).toBe(416); expect(invalid.headers.get("content-range")).toBe("bytes */10");
  });

  it("lets only Host pick a file from any absolute location without exposing its path", async () => {
    const pickedDirectory = await mkdtemp(join(tmpdir(), "watch-picked-"));
    try {
      const pickedPath = join(pickedDirectory, "picked.webm"); await writeFile(pickedPath, "video");
      const { room, hostToken, guestToken } = createProtectedRoom();
      picker.pick = vi.fn().mockResolvedValue(pickedPath);
      const endpoint = `${baseUrl}/api/rooms/${room.id}/host-stream/pick`;
      expect((await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${guestToken}` } })).status).toBe(403);
      expect(picker.pick).not.toHaveBeenCalled();
      const response = await fetch(endpoint, { method: "POST", headers: { Authorization: `Bearer ${hostToken}` } });
      const body = await response.json() as { fileName: string };
      expect(response.status).toBe(200); expect(body.fileName).toBe("picked.webm");
      expect(JSON.stringify(body)).not.toContain(pickedDirectory);
      expect(JSON.stringify(rooms.get(room.id))).not.toContain(pickedDirectory);
      expect(rooms.get(room.id)?.video.source).toMatchObject({ mode: "host-stream", fileName: "picked.webm" });
    } finally { await rm(pickedDirectory, { recursive: true, force: true }); }
  });

  it("rejects outsider tokens and browser-incompatible catalog files", async () => {
    const { room, hostToken } = createProtectedRoom(); const outsider = rooms.create("outsider", "Outsider"); const outsiderToken = rooms.issueStreamToken("outsider")!;
    const file = await streams.register(room.id, moviePath); rooms.setSource("host", { provider: "html5", mode: "host-stream", fileName: file.fileName, streamId: file.streamId });
    expect((await fetch(`${baseUrl}/api/rooms/${room.id}/stream?token=${outsiderToken}`)).status).toBe(401);
    expect((await fetch(`${baseUrl}/api/rooms/${outsider.id}/stream?token=${hostToken}`)).status).toBe(401);
    await writeFile(join(directory, "movie.mkv"), "mkv"); const files = await media.list(); const mkv = files.find((item) => item.fileName === "movie.mkv")!;
    const response = await fetch(`${baseUrl}/api/rooms/${room.id}/host-stream/select`, { method: "POST", headers: { Authorization: `Bearer ${hostToken}`, "Content-Type": "application/json" }, body: JSON.stringify({ fileId: mkv.id }) });
    expect(response.status).toBe(415); expect(await response.json()).toEqual({ error: UNSUPPORTED_MEDIA_MESSAGE });
  });
});
