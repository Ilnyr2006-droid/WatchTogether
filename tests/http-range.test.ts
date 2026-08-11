import { describe, expect, it } from "vitest";
import { parseByteRange } from "@/server/http-range";

describe("HTTP byte ranges", () => {
  it("parses bounded, open-ended and suffix ranges", () => {
    expect(parseByteRange("bytes=2-5", 10)).toEqual({ start: 2, end: 5 });
    expect(parseByteRange("bytes=7-", 10)).toEqual({ start: 7, end: 9 });
    expect(parseByteRange("bytes=-4", 10)).toEqual({ start: 6, end: 9 });
    expect(parseByteRange("bytes=0-99", 10)).toEqual({ start: 0, end: 9 });
  });

  it("rejects unsatisfiable and multipart ranges", () => {
    expect(parseByteRange("bytes=10-11", 10)).toBe("invalid");
    expect(parseByteRange("bytes=6-2", 10)).toBe("invalid");
    expect(parseByteRange("bytes=0-1,4-5", 10)).toBe("invalid");
    expect(parseByteRange(undefined, 10)).toBeNull();
  });
});
