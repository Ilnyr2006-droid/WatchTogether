import { describe, expect, it } from "vitest";
import { FailedAttemptLimiter } from "@/server/failed-attempt-limit";

describe("failed room join limiting", () => {
  it("blocks repeated failures, expires them, and clears after success", () => {
    const limiter = new FailedAttemptLimiter(2, 1_000);
    limiter.recordFailure("ip", 100); limiter.recordFailure("ip", 200);
    expect(limiter.isBlocked("ip", 300)).toBe(true);
    expect(limiter.isBlocked("ip", 1_201)).toBe(false);
    limiter.recordFailure("ip", 1_300); limiter.clear("ip"); expect(limiter.isBlocked("ip", 1_301)).toBe(false);
  });
});
