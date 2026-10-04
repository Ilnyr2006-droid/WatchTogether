import { randomBytes } from "node:crypto";
import { realpath, stat } from "node:fs/promises";
import { basename, extname, isAbsolute } from "node:path";
import type { LocalMediaPublic } from "@/types/realtime";

const MIME_TYPES: Record<string, string> = {
  ".mp4": "video/mp4",
  ".m4v": "video/mp4",
  ".webm": "video/webm",
};

export const UNSUPPORTED_LOCAL_MEDIA_MESSAGE = "Этот формат браузер не может воспроизвести напрямую.";

export class UnsupportedLocalMediaError extends Error {}

interface LocalMediaRecord extends LocalMediaPublic {
  roomId: string;
  absolutePath: string;
  mimeType: string;
  modifiedAt: number;
  createdAt: number;
}

export interface LocalMediaStreamRecord extends LocalMediaPublic {
  absolutePath: string;
  mimeType: string;
  modifiedAt: number;
}

export class LocalMediaRegistry {
  private readonly files = new Map<string, LocalMediaRecord>();
  private readonly roomMediaIds = new Map<string, Set<string>>();
  private readonly transfers = new Map<string, Map<string, Set<{ destroy: () => void }>>>();
  private readonly unavailable = new Set<string>();

  async register(roomId: string, selectedPath: string): Promise<LocalMediaPublic> {
    if (!isAbsolute(selectedPath)) throw new Error("File path must be absolute");
    const absolutePath = await realpath(selectedPath);
    const extension = extname(absolutePath).toLowerCase();
    const mimeType = MIME_TYPES[extension];
    if (!mimeType) throw new UnsupportedLocalMediaError(UNSUPPORTED_LOCAL_MEDIA_MESSAGE);
    const info = await stat(absolutePath);
    if (!info.isFile() || info.size <= 0) throw new Error("Selected path is not a readable regular file");

    let mediaId = "";
    do { mediaId = randomBytes(24).toString("base64url"); } while (this.files.has(mediaId));
    const record: LocalMediaRecord = {
      mediaId,
      roomId,
      absolutePath,
      fileName: basename(absolutePath),
      size: info.size,
      mimeType,
      modifiedAt: info.mtimeMs,
      createdAt: Date.now(),
    };
    this.files.set(mediaId, record);
    const roomIds = this.roomMediaIds.get(roomId) ?? new Set<string>();
    roomIds.add(mediaId);
    this.roomMediaIds.set(roomId, roomIds);
    return publicMetadata(record);
  }

  list(roomId: string): LocalMediaPublic[] {
    return [...(this.roomMediaIds.get(roomId) ?? [])]
      .map((mediaId) => this.files.get(mediaId))
      .filter((record): record is LocalMediaRecord => !!record)
      .map(publicMetadata);
  }

  async resolveForStream(roomId: string, mediaId: string): Promise<LocalMediaStreamRecord | null> {
    const record = this.files.get(mediaId);
    if (!record || record.roomId !== roomId || this.unavailable.has(mediaId)) return null;
    try {
      const info = await stat(record.absolutePath);
      if (!info.isFile() || info.size !== record.size || info.mtimeMs !== record.modifiedAt) {
        this.unavailable.add(mediaId);
        return null;
      }
    } catch {
      this.unavailable.add(mediaId);
      return null;
    }
    return {
      mediaId: record.mediaId,
      fileName: record.fileName,
      size: record.size,
      absolutePath: record.absolutePath,
      mimeType: record.mimeType,
      modifiedAt: record.modifiedAt,
    };
  }

  remove(roomId: string, mediaId: string) {
    const record = this.files.get(mediaId);
    if (!record || record.roomId !== roomId) return false;
    this.files.delete(mediaId);
    this.unavailable.delete(mediaId);
    const roomIds = this.roomMediaIds.get(roomId);
    roomIds?.delete(mediaId);
    if (roomIds?.size === 0) this.roomMediaIds.delete(roomId);
    return true;
  }

  track(roomId: string, socketId: string, transfer: { destroy: () => void }) {
    const roomTransfers = this.transfers.get(roomId) ?? new Map<string, Set<{ destroy: () => void }>>();
    const socketTransfers = roomTransfers.get(socketId) ?? new Set<{ destroy: () => void }>();
    socketTransfers.add(transfer);
    roomTransfers.set(socketId, socketTransfers);
    this.transfers.set(roomId, roomTransfers);
    return () => {
      socketTransfers.delete(transfer);
      if (socketTransfers.size === 0) roomTransfers.delete(socketId);
      if (roomTransfers.size === 0) this.transfers.delete(roomId);
    };
  }

  closeParticipant(socketId: string) {
    for (const [roomId, roomTransfers] of this.transfers) {
      const active = roomTransfers.get(socketId);
      active?.forEach((transfer) => transfer.destroy());
      roomTransfers.delete(socketId);
      if (roomTransfers.size === 0) this.transfers.delete(roomId);
    }
  }

  closeRoomTransfers(roomId: string) {
    const roomTransfers = this.transfers.get(roomId);
    roomTransfers?.forEach((socketTransfers) => socketTransfers.forEach((transfer) => transfer.destroy()));
    this.transfers.delete(roomId);
  }

  clear(roomId: string) {
    for (const mediaId of this.roomMediaIds.get(roomId) ?? []) {
      this.files.delete(mediaId);
      this.unavailable.delete(mediaId);
    }
    this.roomMediaIds.delete(roomId);
    this.closeRoomTransfers(roomId);
  }
}

function publicMetadata(record: LocalMediaRecord): LocalMediaPublic {
  return { mediaId: record.mediaId, fileName: record.fileName, size: record.size };
}
