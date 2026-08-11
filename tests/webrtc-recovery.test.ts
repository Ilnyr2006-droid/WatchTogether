import { describe, expect, it } from "vitest";
import { reconcilePeerIds, recoveryAction } from "@/lib/webrtc-recovery";

describe("WebRTC recovery", () => {
  it("waits on a brief disconnect, retries ICE, then recreates only one peer", () => {
    expect(recoveryAction("disconnected", 0, 0)).toBe("wait");
    expect(recoveryAction("failed", 0, 0)).toBe("restart-ice");
    expect(recoveryAction("failed", 3, 0)).toBe("recreate");
    expect(recoveryAction("failed", 3, 1)).toBe("give-up");
  });

  it("removes stale socket IDs and creates only new reconnect IDs", () => {
    const result = reconcilePeerIds(["old-peer", "stable-peer"], ["new-local", "new-peer", "stable-peer"], "new-local");
    expect(result.remove).toEqual(["old-peer"]);
    expect(result.create).toEqual(["new-peer"]);
    expect([...result.active]).toEqual(["new-peer", "stable-peer"]);
  });
});
