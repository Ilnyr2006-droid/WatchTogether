import { createHash } from "node:crypto";
import { readdir, realpath, stat } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";

const VISIBLE_VIDEO_EXTENSIONS = new Set([".mp4", ".m4v", ".webm", ".mkv", ".avi", ".mov"]);
const DIRECT_EXTENSIONS = new Set([".mp4", ".m4v", ".webm"]);

export interface HostMediaItem { id: string; fileName: string; size: number; browserCompatible: boolean }

export class HostMediaCatalog {
  private readonly directory: string | null;

  constructor(mediaDirectory = process.env.WATCHTOGETHER_MEDIA_DIR || "") {
    this.directory = mediaDirectory.trim() ? resolve(mediaDirectory.trim()) : null;
  }

  isConfigured() { return this.directory !== null; }

  async list(): Promise<HostMediaItem[]> {
    if (!this.directory) throw new Error("WATCHTOGETHER_MEDIA_DIR is not configured");
    const entries = await readdir(this.directory, { withFileTypes: true });
    const items: HostMediaItem[] = [];
    for (const entry of entries) {
      const extension = extname(entry.name).toLowerCase();
      if (!entry.isFile() || !VISIBLE_VIDEO_EXTENSIONS.has(extension)) continue;
      const info = await stat(join(this.directory, entry.name));
      if (info.size <= 0) continue;
      items.push({ id: fileId(entry.name), fileName: entry.name, size: info.size, browserCompatible: DIRECT_EXTENSIONS.has(extension) });
    }
    return items.sort((left, right) => left.fileName.localeCompare(right.fileName));
  }

  async resolveFile(fileIdToFind: string) {
    if (!this.directory || !/^[A-Za-z0-9_-]{32}$/.test(fileIdToFind)) return null;
    const item = (await this.list()).find((candidate) => candidate.id === fileIdToFind);
    if (!item) return null;
    const selectedPath = await realpath(join(this.directory, item.fileName));
    const relativePath = relative(await realpath(this.directory), selectedPath);
    if (!relativePath || relativePath.startsWith("..") || isAbsolute(relativePath)) return null;
    return { ...item, path: selectedPath };
  }
}

function fileId(fileName: string) {
  return createHash("sha256").update(fileName, "utf8").digest("base64url").slice(0, 32);
}
