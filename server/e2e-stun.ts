import { createSocket } from "node:dgram";
import type { AddressInfo } from "node:net";

const MAGIC_COOKIE = 0x2112a442;

export async function startE2EStunServer() {
  const socket = createSocket("udp4");
  socket.on("message", (request, remote) => {
    if (request.byteLength < 20 || request.readUInt16BE(0) !== 0x0001 || request.readUInt32BE(4) !== MAGIC_COOKIE) return;
    const address = remote.address.split(".").map(Number);
    if (address.length !== 4 || address.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return;

    const response = Buffer.alloc(32);
    response.writeUInt16BE(0x0101, 0);
    response.writeUInt16BE(12, 2);
    response.writeUInt32BE(MAGIC_COOKIE, 4);
    request.copy(response, 8, 8, 20);
    response.writeUInt16BE(0x0020, 20);
    response.writeUInt16BE(8, 22);
    response[24] = 0;
    response[25] = 1;
    response.writeUInt16BE(remote.port ^ 0x2112, 26);
    response.writeUInt32BE(((address[0]! << 24) | (address[1]! << 16) | (address[2]! << 8) | address[3]!) ^ MAGIC_COOKIE, 28);
    socket.send(response, remote.port, remote.address);
  });

  await new Promise<void>((resolve, reject) => {
    socket.once("error", reject);
    socket.bind(0, "127.0.0.1", () => {
      socket.off("error", reject);
      resolve();
    });
  });
  const { port } = socket.address() as AddressInfo;
  return { url: `stun:127.0.0.1:${port}`, close: () => socket.close() };
}
