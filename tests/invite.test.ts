import { describe, expect, it } from "vitest";
import { buildInvitation, isPublicIpv4Text, parseInvitation } from "@/lib/invite";

describe("secure invitations", () => {
  const roomId = "a1b2c3d4e5"; const roomToken = "A".repeat(43);

  it("builds and parses an HTTPS room invitation", () => {
    const invitation = buildInvitation("https://watch.example.com", roomId, roomToken);
    expect(invitation).toBe(`https://watch.example.com/room/${roomId}?token=${roomToken}`);
    expect(parseInvitation(invitation)).toMatchObject({ roomId, roomToken, origin: "https://watch.example.com" });
  });

  it("rejects missing tokens, credentials, custom schemes and private manual IPs", () => {
    expect(parseInvitation(`https://watch.example.com/room/${roomId}`)).toBeNull();
    expect(parseInvitation(`watchtogether://watch.example.com/room/${roomId}?token=${roomToken}`)).toBeNull();
    expect(parseInvitation(`https://user:pass@watch.example.com/room/${roomId}?token=${roomToken}`)).toBeNull();
    expect(isPublicIpv4Text("192.168.1.20")).toBe(false); expect(isPublicIpv4Text("95.123.45.67")).toBe(true);
  });
});
