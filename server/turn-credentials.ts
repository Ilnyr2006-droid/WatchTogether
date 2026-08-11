import { createHmac, randomUUID } from "node:crypto";

export const DEFAULT_STUN_URL = "stun:stun.l.google.com:19302";

export interface TurnCredentialOptions {
  turnUrls: string[];
  secret: string;
  ttlSeconds: number;
  userId?: string;
  nowMs?: number;
  stunUrl?: string;
}

export interface IceServerResponse {
  iceServers: RTCIceServer[];
  expiresAt: number | null;
}

export function generateTurnCredentials(options: TurnCredentialOptions): IceServerResponse {
  const nowSeconds = Math.floor((options.nowMs ?? Date.now()) / 1000);
  const ttl = Math.min(86_400, Math.max(60, Math.floor(options.ttlSeconds)));
  const expiresAt = nowSeconds + ttl;
  const safeUserId = (options.userId || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 64) || "anonymous";
  const username = `${expiresAt}:${safeUserId}`;
  const credential = createHmac("sha1", options.secret).update(username).digest("base64");
  return {
    iceServers: [
      { urls: options.stunUrl || DEFAULT_STUN_URL },
      { urls: options.turnUrls, username, credential },
    ],
    expiresAt,
  };
}

export function iceServersFromEnvironment(userId?: string): IceServerResponse {
  const turnUrls = (process.env.TURN_URL || "").split(",").map((url) => url.trim()).filter(Boolean);
  const secret = process.env.TURN_SECRET?.trim();
  const stunUrl = process.env.STUN_URL?.trim() || DEFAULT_STUN_URL;
  const ttl = Number(process.env.TURN_TTL || 3600);
  if (!turnUrls.length || !secret) return { iceServers: [{ urls: stunUrl }], expiresAt: null };
  return generateTurnCredentials({ turnUrls, secret, ttlSeconds: Number.isFinite(ttl) ? ttl : 3600, userId, stunUrl });
}
