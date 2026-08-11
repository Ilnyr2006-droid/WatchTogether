import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import { generateTurnCredentials } from "@/server/turn-credentials";

describe("coturn REST credentials", () => {
  it("generates a bounded timestamp username and HMAC-SHA1 password", () => {
    const result = generateTurnCredentials({ turnUrls: ["turn:turn.example.com:3478"], secret: "server-only-secret", ttlSeconds: 3600, userId: "peer-1", nowMs: 1_700_000_000_000 });
    const turn = result.iceServers[1];
    expect(turn.username).toBe("1700003600:peer-1");
    expect(turn.credential).toBe(createHmac("sha1", "server-only-secret").update(turn.username!).digest("base64"));
    expect(result.expiresAt).toBe(1_700_003_600);
  });

  it("caps unsafe TTL values", () => {
    const result = generateTurnCredentials({ turnUrls: ["turn:x"], secret: "s", ttlSeconds: 999_999, userId: "x", nowMs: 0 });
    expect(result.expiresAt).toBe(86_400);
  });
});
