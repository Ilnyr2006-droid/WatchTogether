import { isIP } from "node:net";

const SERVICES = [
  { url: "https://api.ipify.org?format=json", parse: (body: string) => (JSON.parse(body) as { ip?: unknown }).ip },
  { url: "https://ipv4.icanhazip.com/", parse: (body: string) => body.trim() },
];

export async function lookupPublicIpv4(fetcher: typeof fetch = fetch, timeoutMs = 2_500) {
  for (const service of SERVICES) {
    try {
      const response = await fetcher(service.url, { headers: { Accept: "application/json, text/plain" }, signal: AbortSignal.timeout(timeoutMs), cache: "no-store" });
      if (!response.ok) continue;
      const candidate = service.parse(await response.text());
      if (typeof candidate === "string" && isPublicIpv4(candidate)) return candidate;
    } catch { /* Try the fallback service. */ }
  }
  throw new Error("Public IPv4 lookup failed");
}

export function isPublicIpv4(candidate: string) {
  if (isIP(candidate) !== 4) return false;
  const [a, b] = candidate.split(".").map(Number);
  if (a === 0 || a === 10 || a === 127 || a >= 224) return false;
  if (a === 100 && b >= 64 && b <= 127) return false;
  if (a === 169 && b === 254) return false;
  if (a === 172 && b >= 16 && b <= 31) return false;
  if (a === 192 && b === 168) return false;
  if (a === 198 && (b === 18 || b === 19)) return false;
  return true;
}

export function configuredPublicBaseUrl() {
  const value = (process.env.PUBLIC_URL || process.env.WATCHTOGETHER_PUBLIC_URL)?.trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    if (!(["http:", "https:"].includes(url.protocol)) || url.username || url.password || url.search || url.hash) return null;
    return url.toString().replace(/\/$/, "");
  } catch { return null; }
}
