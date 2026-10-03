import { createServer } from "node:http";
import { loadEnvFile } from "node:process";
import next from "next";
import { attachSocketServer } from "./server/socket-server";
import { handleHostStreamRequest } from "./server/host-stream-http";
import { HostStreamRegistry } from "./server/host-stream-registry";
import { RoomManager } from "./server/room-manager";
import { HostMediaCatalog } from "./server/host-media-catalog";
import { NativeHostFilePicker } from "./server/host-file-picker";
import { isE2ETestMode } from "./server/e2e-mode";
import { startE2EStunServer } from "./server/e2e-stun";

async function main() {
  try { loadEnvFile(); } catch (error) { if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) throw error; }
  if (isE2ETestMode()) {
    const stunServer = await startE2EStunServer();
    process.env.WATCHTOGETHER_E2E_STUN_URL = stunServer.url;
  }
  const dev = process.env.NODE_ENV !== "production";
  const hostname = process.env.HOSTNAME || "0.0.0.0";
  const port = Number(process.env.WATCHTOGETHER_PORT || process.env.PORT || 47821);
  const app = next({ dev, hostname, port });
  const handle = app.getRequestHandler();

  await app.prepare();
  const rooms = new RoomManager();
  const streams = new HostStreamRegistry();
  const media = new HostMediaCatalog();
  const picker = new NativeHostFilePicker();
  let realtime: ReturnType<typeof attachSocketServer> | null = null;
  const server = createServer((request, response) => {
    void (async () => {
      try {
        if (realtime && await handleHostStreamRequest(request, response, { rooms, streams, media, picker, io: realtime.io })) return;
        await handle(request, response);
      } catch {
        if (!response.headersSent) response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        response.end("Internal Server Error");
      }
    })();
  });
  realtime = attachSocketServer(server, { rooms, streams });
  server.listen(port, hostname, () => {
    console.log(`WatchTogether is ready at http://${hostname}:${port}`);
  });
}

main().catch((error) => {
  console.error("Failed to start WatchTogether", error);
  process.exit(1);
});
