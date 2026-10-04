import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { NextResponse } from "next/server";
import { isE2ETestMode } from "@/server/e2e-mode";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, { params }: { params: Promise<{ file: string }> }) {
  if (!isE2ETestMode() || (await params).file !== "e2e-small.mp4")
    return new NextResponse(null, { status: 404 });
  const file = await readFile(join(process.cwd(), "tests/e2e/fixtures/e2e-small.mp4"));
  const headers = {
    "Accept-Ranges": "bytes",
    "Cache-Control": "no-store, private",
    "Content-Type": "video/mp4",
    "X-Content-Type-Options": "nosniff",
  };
  const range = request.headers.get("range");
  if (!range) return new Response(file, { headers: { ...headers, "Content-Length": String(file.byteLength) } });

  const match = /^bytes=(\d*)-(\d*)$/.exec(range);
  if (!match || (!match[1] && !match[2]))
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.byteLength}` } });
  const start = match[1] ? Number(match[1]) : Math.max(0, file.byteLength - Number(match[2]));
  const end = match[2] && match[1] ? Math.min(file.byteLength - 1, Number(match[2])) : file.byteLength - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start > end || start >= file.byteLength)
    return new Response(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${file.byteLength}` } });
  const chunk = file.subarray(start, end + 1);
  return new Response(chunk, { status: 206, headers: {
    ...headers,
    "Content-Length": String(chunk.byteLength),
    "Content-Range": `bytes ${start}-${end}/${file.byteLength}`,
  } });
}
