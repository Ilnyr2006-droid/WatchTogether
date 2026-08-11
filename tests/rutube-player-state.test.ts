import { describe, expect, it } from "vitest";
import { classifyRutubePlayerError, type RutubePlayerStatus } from "@/lib/rutube-player-state";

describe("RUTUBE player status", () => {
  it.each([
    "Видео можно посмотреть только на RUTUBE",
    "Воспроизведение на сторонних сайтах не разрешено",
    "Embedding is not allowed for this video",
  ])("recognizes an embed restriction from the documented player:error text: %s", (text) => {
    expect(classifyRutubePlayerError({ code: "403", text })).toBe("embed-restricted");
  });

  it.each(["Видео не найдено", "Это видео удалено", "Video unavailable"])("recognizes unavailable media: %s", (text) => {
    expect(classifyRutubePlayerError({ text })).toBe("unavailable");
  });

  it("keeps unknown playback failures separate", () => {
    expect(classifyRutubePlayerError({ code: "500", text: "Playback initialization failed" })).toBe("player-error");
  });

  it("recognizes the fatal payload observed for RUTUBE-only playback", () => {
    expect(classifyRutubePlayerError({
      fatal: true,
      type: "blocked_by_copyright",
      message: "This video was hidden because of copyright reasons (please check your VPN connection).",
    })).toBe("embed-restricted");
  });

  it("exposes the five required lifecycle states", () => {
    const states: RutubePlayerStatus[] = ["loading", "ready", "embed-restricted", "unavailable", "player-error"];
    expect(states).toHaveLength(5);
  });
});
