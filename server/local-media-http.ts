import { createReadStream } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Server } from "socket.io";
import type { ClientToServerEvents, InterServerEvents, ServerToClientEvents, SocketData } from "@/types/realtime";
import { hostMediaSelectionSchema, ownerMediaPathSchema } from "./validation";
import { parseByteRange } from "./http-range";
import { HostMediaCatalog } from "./host-media-catalog";
import type { HostFilePicker } from "./host-file-picker";
import { LocalMediaRegistry, UnsupportedLocalMediaError, UNSUPPORTED_LOCAL_MEDIA_MESSAGE } from "./local-media-registry";
import type { RoomManager } from "./room-manager";

type RealtimeServer = Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>;

export interface LocalMediaHttpDependencies {
  rooms: RoomManager;
  localMedia: LocalMediaRegistry;
  catalog: HostMediaCatalog;
  picker: HostFilePicker;
  io: RealtimeServer;
}

const ROUTE = /^\/api\/rooms\/([a-z0-9]{10})\/(owner-media\/(?:files|select|register|pick)|media\/([A-Za-z0-9_-]{32})\/stream)$/;

export async function handleLocalMediaRequest(request: IncomingMessage, response: ServerResponse, dependencies: LocalMediaHttpDependencies) {
  const url = new URL(request.url || "/", "http://localhost");
  const match = ROUTE.exec(url.pathname);
  if (!match) return false;
  const [, roomId, action, mediaId] = match;
  if (action === "owner-media/files") await listFiles(request, response, roomId, dependencies);
  else if (action === "owner-media/select") await selectCatalogFile(request, response, roomId, dependencies);
  else if (action === "owner-media/register") await registerPath(request, response, roomId, dependencies);
  else if (action === "owner-media/pick") await pickFile(request, response, roomId, dependencies);
  else if (mediaId) await streamMedia(request, response, url, roomId, mediaId, dependencies);
  return true;
}

async function listFiles(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: LocalMediaHttpDependencies) {
  if (request.method !== "GET") return methodNotAllowed(response, "GET");
  const session = authorizeOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Файлы компьютера доступны только владельцу комнаты" });
  if (!dependencies.catalog.isConfigured()) return sendJson(response, 503, { error: "Каталог фильмов не настроен; укажите локальный путь к файлу" });
  try { return sendJson(response, 200, { files: await dependencies.catalog.list() }); }
  catch { return sendJson(response, 422, { error: "Не удалось прочитать каталог фильмов" }); }
}

async function selectCatalogFile(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: LocalMediaHttpDependencies) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  const session = authorizeOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Файлы компьютера доступны только владельцу комнаты" });
  if (!dependencies.catalog.isConfigured()) return sendJson(response, 503, { error: "Каталог фильмов не настроен" });
  const body = await readJson(request);
  const parsed = hostMediaSelectionSchema.safeParse(body);
  if (!parsed.success) return sendJson(response, 400, { error: "Некорректный фильм" });
  try {
    const file = await dependencies.catalog.resolveFile(parsed.data.fileId);
    if (!file) return sendJson(response, 404, { error: "Фильм не найден в каталоге" });
    if (!file.browserCompatible) return sendJson(response, 415, { error: UNSUPPORTED_LOCAL_MEDIA_MESSAGE });
    return await registerSelectedFile(response, roomId, session.socketId, file.path, dependencies);
  } catch (error) { return sendRegistrationError(response, error); }
}

async function registerPath(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: LocalMediaHttpDependencies) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  const session = authorizeOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Выбирать локальные файлы может только владелец комнаты" });
  const body = await readJson(request);
  const parsed = ownerMediaPathSchema.safeParse(body);
  if (!parsed.success) return sendJson(response, 400, { error: "Укажите корректный локальный путь" });
  try { return await registerSelectedFile(response, roomId, session.socketId, parsed.data.path, dependencies); }
  catch (error) { return sendRegistrationError(response, error); }
}

async function pickFile(request: IncomingMessage, response: ServerResponse, roomId: string, dependencies: LocalMediaHttpDependencies) {
  if (request.method !== "POST") return methodNotAllowed(response, "POST");
  const session = authorizeOwner(request, roomId, dependencies);
  if (session === "unauthorized") return sendJson(response, 401, { error: "Сначала войдите в эту комнату" });
  if (session === "forbidden") return sendJson(response, 403, { error: "Открывать выбор файлов может только владелец комнаты" });
  try {
    const selectedPath = await dependencies.picker.pick();
    if (!selectedPath) return sendJson(response, 200, { cancelled: true });
    return await registerSelectedFile(response, roomId, session.socketId, selectedPath, dependencies);
  } catch (error) {
    if (error instanceof UnsupportedLocalMediaError) return sendJson(response, 415, { error: UNSUPPORTED_LOCAL_MEDIA_MESSAGE });
    return sendJson(response, 503, { error: "Native file picker недоступен. Укажите локальный путь к фильму." });
  }
}

async function registerSelectedFile(response: ServerResponse, roomId: string, socketId: string, path: string, dependencies: LocalMediaHttpDependencies) {
  if (!dependencies.rooms.isRoomOwner(socketId)) return sendJson(response, 403, { error: "Только владелец комнаты может регистрировать локальные фильмы" });
  const media = await dependencies.localMedia.register(roomId, path);
  const state = dependencies.rooms.addLocalPlaylistItem(socketId, media);
  if (!state) {
    dependencies.localMedia.remove(roomId, media.mediaId);
    return sendJson(response, 409, { error: "Владелец или комната изменились при выборе файла" });
  }
  dependencies.io.to(roomId).emit("room:state", state);
  const item = state.playlist.at(-1);
  return sendJson(response, 200, { item });
}

async function streamMedia(request: IncomingMessage, response: ServerResponse, url: URL, roomId: string, mediaId: string, dependencies: LocalMediaHttpDependencies) {
  if (request.method !== "GET" && request.method !== "HEAD") return methodNotAllowed(response, "GET, HEAD");
  const token = url.searchParams.get("token") || "";
  const session = dependencies.rooms.authorizeStream(roomId, token);
  if (!session) return sendJson(response, 401, { error: "Нет доступа к фильму этой комнаты" });
  const room = dependencies.rooms.get(roomId);
  const source = room?.video.source;
  if (!room || source?.provider !== "html5" || source.mode !== "host-stream" || source.mediaId !== mediaId) {
    return sendJson(response, 404, { error: "Этот фильм сейчас не выбран" });
  }
  const file = await dependencies.localMedia.resolveForStream(roomId, mediaId);
  if (!file) {
    const itemId = room.currentPlaylistItemId;
    const item = itemId ? dependencies.rooms.getPlaylistItem(roomId, itemId) : null;
    if (item && itemId) dependencies.io.to(roomId).emit("room:playlist-error", { itemId, message: `Файл «${item.title}» больше недоступен. Выберите его снова или удалите из очереди.` });
    const stopped = dependencies.rooms.clearSource(roomId, session.participantId);
    dependencies.localMedia.closeRoomTransfers(roomId);
    if (stopped) dependencies.io.to(roomId).emit("video:state", stopped);
    return sendJson(response, 410, { error: "Локальный фильм больше недоступен" });
  }

  const range = parseByteRange(request.headers.range, file.size);
  if (range === "invalid") {
    response.writeHead(416, { "Accept-Ranges": "bytes", "Content-Range": `bytes */${file.size}`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
    return response.end();
  }
  const start = range?.start ?? 0;
  const end = range?.end ?? file.size - 1;
  const headers: Record<string, string | number> = {
    "Accept-Ranges": "bytes",
    "Content-Type": file.mimeType,
    "Content-Length": end - start + 1,
    "Cache-Control": "private, no-store",
    "X-Content-Type-Options": "nosniff",
  };
  if (range) headers["Content-Range"] = `bytes ${start}-${end}/${file.size}`;
  response.writeHead(range ? 206 : 200, headers);
  if (request.method === "HEAD") return response.end();

  const fileStream = createReadStream(file.absolutePath, { start, end });
  const untrack = dependencies.localMedia.track(roomId, session.socketId, fileStream);
  fileStream.on("error", () => { untrack(); if (!response.headersSent) response.writeHead(500); response.destroy(); });
  response.on("close", () => { untrack(); fileStream.destroy(); });
  fileStream.pipe(response);
}

function authorizeOwner(request: IncomingMessage, roomId: string, dependencies: LocalMediaHttpDependencies) {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(request.headers.authorization || "");
  const session = match ? dependencies.rooms.authorizeStream(roomId, match[1]!) : null;
  if (!session) return "unauthorized" as const;
  if (!session.isOwner) return "forbidden" as const;
  return session;
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += bytes.length;
    if (length > 8_192) return null;
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
  catch { return null; }
}

function sendRegistrationError(response: ServerResponse, error: unknown) {
  if (error instanceof UnsupportedLocalMediaError) return sendJson(response, 415, { error: UNSUPPORTED_LOCAL_MEDIA_MESSAGE });
  return sendJson(response, 422, { error: "Файл не найден, изменился или недоступен для чтения" });
}

function methodNotAllowed(response: ServerResponse, allow: string) {
  response.setHeader("Allow", allow);
  return sendJson(response, 405, { error: "Метод не поддерживается" });
}

function sendJson(response: ServerResponse, status: number, body: object) {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" });
  response.end(JSON.stringify(body));
}
