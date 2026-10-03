import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { iceServersFromEnvironment } from "@/server/turn-credentials";
import { isE2ETestMode } from "@/server/e2e-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (isE2ETestMode()) {
    const stunUrl = process.env.WATCHTOGETHER_E2E_STUN_URL;
    return NextResponse.json({ iceServers: stunUrl ? [{ urls: stunUrl }] : [], expiresAt: null }, {
      headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
    });
  }
  return NextResponse.json(iceServersFromEnvironment(randomUUID()), {
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}
