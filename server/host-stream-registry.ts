import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import { randomBytes } from "node:crypto";

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};

export const UNSUPPORTED_MEDIA_MESSAGE = "Этот формат нельзя воспроизвести напрямую в браузере. Требуется конвертация.";

export class UnsupportedHostMediaError extends Error {}

export interface HostStreamFile {
  path: string;
  fileName: string;
  contentType: string;
  size: number;
  modifiedAt: number;
  streamId: string;
}

export class HostStreamRegistry {
  private readonly files = new Map<string, HostStreamFile>();
  private readonly transfers = new Map<string, Map<string, Set<{ destroy: () => void }>>>();

  async register(roomId: string, selectedPath: string) {
    if (!isAbsolute(selectedPath)) throw new Error("File picker returned a non-absolute path");
    const resolvedPath = await realpath(selectedPath);
    const extension = extname(resolvedPath).toLowerCase();
    const contentType = MIME_TYPES[extension];
    if (!contentType) throw new UnsupportedHostMediaError(UNSUPPORTED_MEDIA_MESSAGE);
    const info = await stat(resolvedPath);
    if (!info.isFile() || info.size <= 0) throw new Error("Selected path is not a readable video file");
    const file = { path: resolvedPath, fileName: basename(resolvedPath), contentType, size: info.size, modifiedAt: info.mtimeMs, streamId: randomBytes(12).toString("base64url") };
    this.closeRoomTransfers(roomId);
    this.files.set(roomId, file);
    return { ...file };
  }

  get(roomId: string) {
    const file = this.files.get(roomId);
    return file ? { ...file } : null;
  }

  async refresh(roomId: string) {
    const file = this.files.get(roomId);
    if (!file) return null;
    const info = await stat(file.path);
    if (!info.isFile() || info.size <= 0) return null;
    file.size = info.size;
    file.modifiedAt = info.mtimeMs;
    return { ...file };
  }

  track(roomId: string, socketId: string, transfer: { destroy: () => void }) {
    const roomTransfers = this.transfers.get(roomId) ?? new Map<string, Set<{ destroy: () => void }>>();
    const participantTransfers = roomTransfers.get(socketId) ?? new Set<{ destroy: () => void }>();
    participantTransfers.add(transfer); roomTransfers.set(socketId, participantTransfers); this.transfers.set(roomId, roomTransfers);
    return () => {
      participantTransfers.delete(transfer);
      if (participantTransfers.size === 0) roomTransfers.delete(socketId);
      if (roomTransfers.size === 0) this.transfers.delete(roomId);
    };
  }

  closeParticipant(socketId: string) {
    for (const [roomId, roomTransfers] of this.transfers) {
      const transfers = roomTransfers.get(socketId);
      transfers?.forEach((transfer) => transfer.destroy());
      roomTransfers.delete(socketId);
      if (roomTransfers.size === 0) this.transfers.delete(roomId);
    }
  }

  clear(roomId: string) { this.files.delete(roomId); this.closeRoomTransfers(roomId); }

  private closeRoomTransfers(roomId: string) {
    const roomTransfers = this.transfers.get(roomId);
    roomTransfers?.forEach((transfers) => transfers.forEach((transfer) => transfer.destroy()));
    this.transfers.delete(roomId);
  }
}
