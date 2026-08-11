import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { iceServersFromEnvironment } from "@/server/turn-credentials";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(iceServersFromEnvironment(randomUUID()), {
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}
