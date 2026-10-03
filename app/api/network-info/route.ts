import { NextResponse } from "next/server";
import { configuredPublicBaseUrl, lookupPublicIpv4 } from "@/server/public-ip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (process.env.WATCHTOGETHER_E2E === "1") {
    const port = Number(process.env.WATCHTOGETHER_PORT || process.env.PORT || 47821);
    return NextResponse.json({ publicBaseUrl: `http://127.0.0.1:${port}`, publicIp: null, port }, {
      headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
    });
  }
  const publicBaseUrl = configuredPublicBaseUrl();
  let publicIp: string | null = null;
  try { publicIp = await lookupPublicIpv4(); } catch { /* The UI offers manual input. */ }
  return NextResponse.json({ publicBaseUrl, publicIp, port: Number(process.env.WATCHTOGETHER_PORT || process.env.PORT || 47821) }, {
    headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff" },
  });
}
