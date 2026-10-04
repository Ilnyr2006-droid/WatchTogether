import { describe, expect, it } from "vitest";
import {
  canHandleMediaSessionAction,
  createMediaPositionState,
  getMediaSeekTarget,
  getMediaSessionMetadata,
  supportsPictureInPicture,
} from "@/lib/mobile-media";

describe("mobile media capability and action helpers", () => {
  it("detects Picture-in-Picture only when both browser and video APIs are present", () => {
    expect(supportsPictureInPicture({ pictureInPictureEnabled: true }, { requestPictureInPicture: () => Promise.resolve({} as PictureInPictureWindow) })).toBe(true);
    expect(supportsPictureInPicture({ pictureInPictureEnabled: false }, { requestPictureInPicture: () => Promise.resolve({} as PictureInPictureWindow) })).toBe(false);
    expect(supportsPictureInPicture({ pictureInPictureEnabled: true }, {} as HTMLVideoElement)).toBe(false);
    expect(supportsPictureInPicture(undefined, undefined)).toBe(false);
  });

  it("allows Media Session actions only when the participant can control playback", () => {
    expect(canHandleMediaSessionAction(true)).toBe(true);
    expect(canHandleMediaSessionAction(false)).toBe(false);
  });

  it("converts seekto, seekbackward, and seekforward into bounded positions", () => {
    expect(getMediaSeekTarget("seekto", 20, 30, { seekTime: 42 })).toBe(30);
    expect(getMediaSeekTarget("seekto", 20, 30, { seekTime: -5 })).toBe(0);
    expect(getMediaSeekTarget("seekto", 20, 30, {})).toBeNull();
    expect(getMediaSeekTarget("seekbackward", 20, 30, {})).toBe(10);
    expect(getMediaSeekTarget("seekforward", 25, 30, { seekOffset: 20 })).toBe(30);
    expect(getMediaSeekTarget("seekforward", Number.NaN, Number.NaN, { seekOffset: 4 })).toBe(4);
  });

  it("rejects invalid position states and clamps a playhead at duration", () => {
    expect(createMediaPositionState(Number.NaN, 0, 1)).toBeNull();
    expect(createMediaPositionState(0, 0, 1)).toBeNull();
    expect(createMediaPositionState(20, Number.NaN, 1)).toBeNull();
    expect(createMediaPositionState(20, 3, 0)).toBeNull();
    expect(createMediaPositionState(20, 25, 1)).toEqual({ duration: 20, position: 20, playbackRate: 1 });
  });

  it("creates safe metadata for URL and RUTUBE sources without leaking query secrets", () => {
    const urlMetadata = getMediaSessionMetadata({ provider: "html5", mode: "url", url: "https://cdn.example/video.mp4?token=do-not-show#fragment" }, "room123");
    expect(urlMetadata).toEqual({ title: "Видео · cdn.example", artist: "WatchTogether", album: "Комната room123" });
    expect(JSON.stringify(urlMetadata)).not.toContain("do-not-show");

    const rutubeMetadata = getMediaSessionMetadata({ provider: "rutube", videoId: "secret-id", accessKey: "secret-key", originalUrl: "https://rutube.ru/video/secret-id/?p=secret-key" }, "room123");
    expect(rutubeMetadata).toEqual({ title: "Видео на RUTUBE", artist: "WatchTogether", album: "Комната room123" });
    expect(JSON.stringify(rutubeMetadata)).not.toContain("secret");
  });
});
