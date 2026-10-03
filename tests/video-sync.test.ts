import { describe, expect, it } from "vitest";
import { effectiveVideoTime, getLocalPlaybackIntent, isNewerVideoRevision, needsTimeCorrection } from "@/lib/video-sync";

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

  it("suppresses remote playback echoes by desired state without blocking a new local intent", () => {
    expect(getLocalPlaybackIntent("pause", false).shouldEmit).toBe(false);
    expect(getLocalPlaybackIntent("play", true).shouldEmit).toBe(false);
    expect(getLocalPlaybackIntent("play", false).shouldEmit).toBe(true);
  });

  it("updates local playback intent across rapid play-pause-play events", () => {
    let desiredPlaying: boolean | null = false;
    for (const action of ["play", "pause", "play"] as const) {
      const intent = getLocalPlaybackIntent(action, desiredPlaying);
      expect(intent.shouldEmit).toBe(true);
      desiredPlaying = intent.desiredPlaying;
    }
    expect(desiredPlaying).toBe(true);

    const remotePause = getLocalPlaybackIntent("pause", false);
    expect(remotePause.shouldEmit).toBe(false);
    expect(remotePause.desiredPlaying).toBe(false);
  });
});
