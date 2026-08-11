import { describe, expect, it } from "vitest";
import { IceCandidateQueue, decideIncomingDescription, isPolitePeer } from "@/lib/webrtc-negotiation";

describe("ICE candidate queue", () => {
  it("keeps early candidates and flushes them in arrival order", async () => {
    const queue = new IceCandidateQueue<string>();
    queue.enqueue("first"); queue.enqueue("second");
    const added: string[] = [];
    await queue.flush(async (candidate) => { added.push(candidate); });
    expect(added).toEqual(["first", "second"]);
    expect(queue.size).toBe(0);
  });

  it("does not lose the remaining queue when adding a candidate fails", async () => {
    const queue = new IceCandidateQueue<string>(); queue.enqueue("candidate"); queue.enqueue("later");
    await expect(queue.flush(async () => { throw new Error("invalid"); })).rejects.toThrow("invalid");
    expect(queue.size).toBe(2);
  });
});

describe("Perfect Negotiation decisions", () => {
  it("makes exactly one side polite", () => {
    expect(isPolitePeer("a", "b")).toBe(false);
    expect(isPolitePeer("b", "a")).toBe(true);
  });

  it("ignores glare on the impolite side", () => {
    expect(decideIncomingDescription({ polite: false, makingOffer: true, isSettingRemoteAnswerPending: false }, "stable", "offer")).toMatchObject({ offerCollision: true, ignoreOffer: true });
  });

  it("accepts glare on the polite side and answers while SRD is pending", () => {
    expect(decideIncomingDescription({ polite: true, makingOffer: true, isSettingRemoteAnswerPending: false }, "have-local-offer", "offer").ignoreOffer).toBe(false);
    expect(decideIncomingDescription({ polite: false, makingOffer: false, isSettingRemoteAnswerPending: true }, "have-local-offer", "offer").readyForOffer).toBe(true);
  });
});
