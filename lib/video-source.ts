import type { VideoSource } from "@/types/realtime";

const RUTUBE_ID = /^[a-zA-Z0-9_-]{6,128}$/;
const ACCESS_KEY = /^[a-zA-Z0-9_-]{1,256}$/;
const DIRECT_VIDEO_EXTENSION = /\.(mp4|webm|ogg|ogv|m4v)$/i;

export function parseRutubeUrl(
  input: string,
): Extract<VideoSource, { provider: "rutube" }> | null {
  try {
    const url = new URL(input.trim());
    if (
      url.protocol !== "https:" ||
      !["rutube.ru", "www.rutube.ru"].includes(url.hostname.toLowerCase())
    )
      return null;
    const parts = url.pathname.split("/").filter(Boolean);
    let videoId: string | undefined;
    if ((parts[0] === "video" || parts[0] === "shorts") && parts.length === 2)
      videoId = parts[1];
    if (parts[0] === "play" && parts[1] === "embed" && parts.length === 3)
      videoId = parts[2];
    if (!videoId || !RUTUBE_ID.test(videoId)) return null;
    const rawAccessKey = url.searchParams.get("p");
    const accessKey =
      rawAccessKey && ACCESS_KEY.test(rawAccessKey) ? rawAccessKey : null;
    return {
      provider: "rutube",
      videoId,
      accessKey,
      originalUrl: `https://rutube.ru/${parts[0] === "play" ? `play/embed/${videoId}` : `${parts[0]}/${videoId}/`}`,
    };
  } catch {
    return null;
  }
}

export function parseSubmittedVideoUrl(input: string): VideoSource | null {
  const rutube = parseRutubeUrl(input);
  if (rutube) return rutube;
  try {
    const url = new URL(input.trim());
    if (
      !["http:", "https:"].includes(url.protocol) ||
      !DIRECT_VIDEO_EXTENSION.test(url.pathname)
    )
      return null;
    return { provider: "html5", mode: "url", url: url.toString() };
  } catch {
    return null;
  }
}

export function buildRutubeEmbedUrl(
  source: Extract<VideoSource, { provider: "rutube" }>,
) {
  const url = new URL(
    `https://rutube.ru/play/embed/${encodeURIComponent(source.videoId)}`,
  );
  if (source.accessKey) url.searchParams.set("p", source.accessKey);
  return url.toString();
}

export function publicSourceLabel(source: VideoSource | null) {
  if (!source) return "Не выбран";
  if (source.provider === "rutube") return "RUTUBE";
  if (source.mode === "local") return "Локальный файл у каждого";
  if (source.mode === "host-stream") return `Фильм Host · ${source.fileName}`;
  if (source.mode === "p2p-movie") return `P2P фильм · ${source.fileName}`;
  return "Видео по URL";
}
