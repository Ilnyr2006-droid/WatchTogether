import { describe, expect, it } from "vitest";
import { effectiveVideoTime, needsTimeCorrection } from "@/lib/video-sync";

describe("video synchronization", () => {
  it("accounts for elapsed server time while playing", () => {
    expect(effectiveVideoTime({ source: { provider: "html5", mode: "url", url: "x" }, currentTime: 10, playing: true, updatedAt: 1_000 }, 3_500)).toBe(12.5);
  });

  it("does not advance a paused video", () => {
    expect(effectiveVideoTime({ source: { provider: "html5", mode: "url", url: "x" }, currentTime: 10, playing: false, updatedAt: 1_000 }, 3_500)).toBe(10);
  });

  it("corrects only meaningful drift", () => {
    expect(needsTimeCorrection(10, 10.4)).toBe(false);
    expect(needsTimeCorrection(10, 11)).toBe(true);
  });
});
