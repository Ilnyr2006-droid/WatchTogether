import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "socket.io";
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData, VideoSource } from "@/types/realtime";
import { HostStreamRegistry, UnsupportedHostMediaError, UNSUPPORTED_MEDIA_MESSAGE } from "./host-stream-registry";
import { parseByteRange } from "./http-range";
import type { RoomManager } from "./room-manager";
import type { HostMediaCatalog } from "./host-media-catalog";
import type { HostFilePicker } from "./host-file-picker";

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface HostStreamHttpDependencies {
  rooms: RoomManager;
  streams: HostStreamRegistry;
  media: HostMediaCatalog;
  picker: HostFilePicker;
  io: RealtimeServer;
}

const ROUTE = /^\/api\/rooms\/([a-z0-9]{10})\/(stream|host-stream\/(?:files|select|pick))$/;

export async function handleHostStreamRequest(request: IncomingMessage, response: ServerResponse, dependencies: HostStreamHttpDependencies) {
  const url = new URL(request.url || "/", "http://localhost");
  const match = ROUTE.exec(url.pathname);
  if (!match) return false;
  const [, roomId, action] = match;

  if (action === "host-stream/files") {
    await listHostFiles(request, response, roomId, dependencies);
    return true;
  }
  if (action === "host-stream/select") {
    await selectHostFile(request, response, roomId, dependencies);
    return true;
  }
  if (action === "host-stream/pick") {
    await pickHostFile(request, response, roomId, dependencies);
    return true;
  }

  await streamHostFile(request, response, url, roomId, dependencies);
  return true;
}

async function listHostFiles(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: HostStreamHttpDependencies) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  const session = authorizeBearerOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Файлы компьютера доступны только владельцу комнаты" });
  if (!dependencies.media.isConfigured()) return sendJson(response, 503, { error: "Дополнительная папка WATCHTOGETHER_MEDIA_DIR не настроена" });
  try { return sendJson(response, 200, { files: await dependencies.media.list() }); }
  catch { return sendJson(response, 422, { error: "Не удалось прочитать папку с фильмами" }); }
}

async function selectHostFile(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: HostStreamHttpDependencies) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  const session = authorizeBearerOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Только владелец комнаты может выбрать файл" });
  if (!dependencies.media.isConfigured()) return sendJson(response, 503, { error: "Дополнительная папка WATCHTOGETHER_MEDIA_DIR не настроена" });

  try {
    const body = await readSelection(request);
    if (!body) return sendJson(response, 400, { error: "Некорректный идентификатор фильма" });
    const selected = await dependencies.media.resolveFile(body.fileId);
    if (!selected) return sendJson(response, 404, { error: "Фильм не найден в настроенной папке" });
    if (!selected.browserCompatible) return sendJson(response, 415, { error: UNSUPPORTED_MEDIA_MESSAGE });
    const file = await dependencies.streams.register(roomId, selected.path);
    const source: VideoSource = { provider: "html5", mode: "host-stream", fileName: file.fileName, streamId: file.streamId };
    const video = dependencies.rooms.setSource(session.socketId, source);
    if (!video) { dependencies.streams.clear(roomId); return sendJson(response, 409, { error: "Host или комната изменились во время выбора файла" }); }
    dependencies.io.to(roomId).emit("video:state", video);
    return sendJson(response, 200, { fileName: file.fileName });
  } catch (error) {
    if (error instanceof UnsupportedHostMediaError) return sendJson(response, 415, { error: UNSUPPORTED_MEDIA_MESSAGE });
    return sendJson(response, 422, { error: "Файл не найден или недоступен для чтения" });
  }
}

async function pickHostFile(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: HostStreamHttpDependencies) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  const session = authorizeBearerOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Только владелец комнаты может выбрать файл" });

  try {
    const selectedPath = await dependencies.picker.pick();
    if (!selectedPath) return sendJson(response, 200, { cancelled: true });
    const file = await dependencies.streams.register(roomId, selectedPath);
    const source: VideoSource = { provider: "html5", mode: "host-stream", fileName: file.fileName, streamId: file.streamId };
    const video = dependencies.rooms.setSource(session.socketId, source);
    if (!video) { dependencies.streams.clear(roomId); return sendJson(response, 409, { error: "Host или комната изменились во время выбора файла" }); }
    dependencies.io.to(roomId).emit("video:state", video);
    return sendJson(response, 200, { cancelled: false, fileName: file.fileName });
  } catch (error) {
    if (error instanceof UnsupportedHostMediaError) return sendJson(response, 415, { error: UNSUPPORTED_MEDIA_MESSAGE });
    return sendJson(response, 422, { error: "Не удалось открыть выбранный файл" });
  }
}

function authorizeBearerOwner(request: IncomingMessage, roomId: string, dependencies: HostStreamHttpDependencies) {
  const token = bearerToken(request.headers.authorization);
  const session = token ? dependencies.rooms.authorizeStream(roomId, token) : null;
  if (!session) return "unauthorized" as const;
  if (!session.isOwner) return "forbidden" as const;
  return session;
}

async function readSelection(request: IncomingMessage) {
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length; if (size > 4_096) return null; chunks.push(buffer);
  }
  try {
    const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
    const keys = Object.keys(parsed); const fileId = "fileId" in parsed ? (parsed as { fileId?: unknown }).fileId : null;
    return keys.length === 1 && typeof fileId === "string" && /^[A-Za-z0-9_-]{32}$/.test(fileId) ? { fileId } : null;
  } catch { return null; }
}

async function streamHostFile(request: IncomingMessage, response: ServerResponse, url: URL, roomId: string, dependencies: HostStreamHttpDependencies) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, "GET, HEAD");
  const token = url.searchParams.get("token") || "";
  const session = dependencies.rooms.authorizeStream(roomId, token);
  if (!session) return sendJson(response, 401, { error: "Нет доступа к фильму этой комнаты" });
  const room = dependencies.rooms.get(roomId);
  const source = room?.video.source;
  if (!source || source.provider !== "html5" || source.mode !== "host-stream") return sendJson(response, 404, { error: "Трансляция в комнате не запущена" });

  let file;
  try { file = await dependencies.streams.refresh(roomId); }
  catch { file = null; }
  if (!file || file.fileName !== source.fileName || file.streamId !== source.streamId) {
    stopUnavailableStream(roomId, session.participantId, dependencies);
    return sendJson(response, 410, { error: "Фильм больше недоступен на компьютере Host" });
  }

  const range = parseByteRange(request.headers.range, file.size);
  if (range === "invalid") {
    response.writeHead(416, { "Accept-Ranges": "bytes", "Content-Range": `bytes */${file.size}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return response.end();
  }

  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const status = range ? 206 : 200;
  const headers: Record<string, string | number> = {
    "Accept-Ranges": "bytes",
    "Content-Type": file.contentType,
    "Content-Length": end - start + 1,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  response.writeHead(status, headers);
  if (request.method === "HEAD") return response.end();

  const fileStream = createReadStream(file.path, { start, end });
  const untrack = dependencies.streams.track(roomId, session.socketId, fileStream);
  fileStream.on("error", () => { untrack(); if (!response.headersSent) response.writeHead(500); response.destroy(); });
  response.on("close", () => { untrack(); fileStream.destroy(); });
  fileStream.pipe(response);
}

function stopUnavailableStream(roomId: string, participantId: string, dependencies: HostStreamHttpDependencies) {
  dependencies.streams.clear(roomId);
  const video = dependencies.rooms.clearSource(roomId, participantId);
  if (video) dependencies.io.to(roomId).emit("video:state", video);
  dependencies.io.to(roomId).emit("room:error", { code: "HOST_STREAM_UNAVAILABLE", message: "Фильм больше недоступен на компьютере Host" });
}

function bearerToken(header?: string) {
  const match = /^Bearer ([A-Za-z0-9_-]{40,60})$/.exec(header || "");
  return match?.[1] || null;
}

function methodNotAllowed(response: ServerResponse, allow: string) {
  response.setHeader("Allow", allow);
  return sendJson(response, 405, { error: "Метод не поддерживается" });
}

function sendJson(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}
