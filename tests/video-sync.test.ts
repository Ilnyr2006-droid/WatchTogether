import { describe, expect, it } from "vitest";
import { effectiveVideoTime, isNewerVideoRevision, needsTimeCorrection, shouldEmitPlaybackAction } from "@/lib/video-sync";

describe("video synchronization", () => {
  it("accounts for elapsed server time while playing", () => {
    expect(effectiveVideoTime({ source: { provider: "html5", mode: "url", url: "x" }, currentTime: 10, playing: true, updatedAt: 1_000, revision: 1, updatedBy: "p" }, 3_500)).toBe(12.5);
  });

  it("does not advance a paused video", () => {
    expect(effectiveVideoTime({ source: { provider: "html5", mode: "url", url: "x" }, currentTime: 10, playing: false, updatedAt: 1_000, revision: 1, updatedBy: "p" }, 3_500)).toBe(10);
  });

  it("corrects only meaningful drift", () => {
    expect(needsTimeCorrection(10, 10.4)).toBe(false);
    expect(needsTimeCorrection(10, 11)).toBe(true);
  });

  it("accepts only a strictly newer authoritative revision", () => {
    expect(isNewerVideoRevision(3, 4)).toBe(true);
    expect(isNewerVideoRevision(4, 4)).toBe(false);
    expect(isNewerVideoRevision(4, 3)).toBe(false);
  });

  it("suppresses playback events caused while applying remote state", () => {
    expect(shouldEmitPlaybackAction("pause", false, true)).toBe(false);
    expect(shouldEmitPlaybackAction("play", false, true)).toBe(false);
    expect(shouldEmitPlaybackAction("pause", false, false)).toBe(false);
    expect(shouldEmitPlaybackAction("play", false, false)).toBe(true);
  });
});
