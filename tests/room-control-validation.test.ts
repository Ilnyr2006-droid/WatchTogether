import { describe, expect, it } from "vitest";
import { roomControlModeSchema, roomControlTargetSchema } from "@/server/validation";

describe("room control event validation", () => {
  it("accepts only the supported control modes", () => {
    for (const mode of ["everyone", "host-only", "approved"])
      expect(roomControlModeSchema.safeParse({ mode }).success).toBe(true);
    expect(roomControlModeSchema.safeParse({ mode: "guest" }).success).toBe(false);
    expect(roomControlModeSchema.safeParse({ mode: "everyone", extra: true }).success).toBe(false);
  });

  it("accepts only a participantId target for approve, reject, and revoke", () => {
    expect(roomControlTargetSchema.safeParse({ participantId: "a".repeat(32) }).success).toBe(true);
    expect(roomControlTargetSchema.safeParse({ participantId: "short" }).success).toBe(false);
    expect(roomControlTargetSchema.safeParse({ participantId: "g".repeat(32) }).success).toBe(false);
    expect(roomControlTargetSchema.safeParse({ participantId: "a".repeat(32), approved: true }).success).toBe(false);
  });
});
