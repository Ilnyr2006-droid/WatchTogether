import { createServer } from "node:http";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it } from "vitest";
import { io as createClient, type Socket } from "socket.io-client";
import { HostStreamRegistry } from "@/server/host-stream-registry";
import { RoomManager } from "@/server/room-manager";
import { attachSocketServer } from "@/server/socket-server";
import type { ClientToServerEvents, ServerToClientEvents } from "@/types/realtime";

describe("host stream lifecycle", () => {
  const clients: Socket<ServerToClientEvents, ClientToServerEvents>[] = [];
  const directories: string[] = [];

  afterEach(async () => {
    clients.forEach((client) => client.disconnect()); clients.length = 0;
    await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
  });

  it("stops the stream, clears the path and informs guests when Host leaves", async () => {
    const rooms = new RoomManager(); const streams = new HostStreamRegistry(); const http = createServer();
    const realtime = attachSocketServer(http, { rooms, streams });
    await new Promise<void>((resolve) => http.listen(0, "127.0.0.1", resolve));
    const baseUrl = `http://127.0.0.1:${(http.address() as AddressInfo).port}`;
    const host = createClient(baseUrl); const guest = createClient(baseUrl); clients.push(host, guest);
    await Promise.all([host, guest].map((client) => new Promise<void>((resolve) => client.on("connect", () => resolve()))));
    const created = await new Promise<{ ok: true; data: { roomId: string; roomToken: string } }>((resolve) => host.emit("room:create", { username: "Host" }, (response: { ok: true; data: { roomId: string; roomToken: string } } | { ok: false; error: string }) => resolve(response as { ok: true; data: { roomId: string; roomToken: string } })));
    await new Promise<void>((resolve) => guest.emit("room:join", { roomId: created.data.roomId, username: "Guest", roomToken: created.data.roomToken }, () => resolve()));
    const directory = await mkdtemp(join(tmpdir(), "watch-lifecycle-")); directories.push(directory);
    const path = join(directory, "movie.webm"); await writeFile(path, "video");
    const file = await streams.register(created.data.roomId, path);
    rooms.setSource(host.id!, { provider: "html5", mode: "host-stream", fileName: file.fileName, streamId: file.streamId });
    let transferDestroyed = false;
    streams.track(created.data.roomId, guest.id!, { destroy: () => { transferDestroyed = true; } });

    const stopped = new Promise<string>((resolve) => guest.on("room:error", ({ code, message }) => { if (code === "HOST_STREAM_STOPPED") resolve(message); }));
    host.emit("room:leave");
    expect(await stopped).toContain("Трансляция фильма остановлена");
    expect(streams.get(created.data.roomId)).toBeNull();
    expect(transferDestroyed).toBe(true);
    expect(rooms.get(created.data.roomId)?.video.source).toBeNull();
    realtime.io.close();
    await new Promise<void>((resolve) => http.close(() => resolve()));
  });
});
