const ROOM_ID = /^[a-z0-9]{10}$/;
const ROOM_TOKEN = /^[A-Za-z0-9_-]{43}$/;

export interface WatchInvitation { url: string; origin: string; roomId: string; roomToken: string }

export function buildInvitation(baseUrl: string, roomId: string, roomToken: string) {
  if (!ROOM_ID.test(roomId) || !ROOM_TOKEN.test(roomToken)) throw new Error("Invalid room credentials");
  const url = new URL(baseUrl);
  if (!["http:", "https:"].includes(url.protocol)) throw new Error("Invitation must use HTTP(S)");
  url.pathname = `/room/${roomId}`; url.search = ""; url.hash = ""; url.searchParams.set("token", roomToken);
  return url.toString();
}

export function parseInvitation(value: string): WatchInvitation | null {
  try {
    const url = new URL(value.trim());
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) return null;
    const match = /^\/room\/([a-z0-9]{10})\/?$/.exec(url.pathname);
    const roomToken = url.searchParams.get("token") || "";
    if (!match || !ROOM_TOKEN.test(roomToken)) return null;
    return { url: url.toString(), origin: url.origin, roomId: match[1], roomToken };
  } catch { return null; }
}

export function isPublicIpv4Text(value: string) {
  const parts = value.trim().split(".");
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return false;
  const [a, b] = parts.map(Number);
  return !(a === 0 || a === 10 || a === 127 || a >= 224 || (a === 100 && b >= 64 && b <= 127) || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168));
}
