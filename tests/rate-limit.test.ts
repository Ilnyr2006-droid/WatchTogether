import { describe, expect, it } from "vitest";
import { RateLimiter } from "@/server/rate-limit";

describe("separate rate limit buckets", () => {
  it("does not let chat saturation consume the ICE bucket", () => {
    const chat = new RateLimiter(1, 10_000);
    const ice = new RateLimiter(3, 10_000);
    expect(chat.allow("socket", 100)).toBe(true);
    expect(chat.allow("socket", 101)).toBe(false);
    expect([ice.allow("socket", 101), ice.allow("socket", 102), ice.allow("socket", 103)]).toEqual([true, true, true]);
    expect(ice.allow("socket", 104)).toBe(false);
  });

  it("keeps voice and movie ICE candidate budgets independent", () => {
    const voiceIce = new RateLimiter(1, 10_000);
    const movieIce = new RateLimiter(1, 10_000);
    expect(voiceIce.allow("socket", 100)).toBe(true);
    expect(voiceIce.allow("socket", 101)).toBe(false);
    expect(movieIce.allow("socket", 101)).toBe(true);
  });
});
