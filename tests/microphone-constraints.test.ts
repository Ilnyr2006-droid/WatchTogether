import { describe, expect, it } from "vitest";
import { microphoneConstraintAttempts } from "@/lib/microphone-constraints";

describe("microphone constraints", () => {
  it("keeps noise processing but does not amplify quiet Mac input", () => {
    const [primary] = microphoneConstraintAttempts("mac-microphone", true);

    expect(primary.audio).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: 1,
      voiceIsolation: true,
      deviceId: { exact: "mac-microphone" },
    });
  });

  it("falls back without optional voice isolation", () => {
    const attempts = microphoneConstraintAttempts(undefined, false);

    expect(attempts).toHaveLength(3);
    expect(attempts[0].audio).not.toHaveProperty("voiceIsolation");
    expect(attempts[1].audio).toMatchObject({ autoGainControl: false });
    expect(attempts[2]).toEqual({ audio: true, video: false });
  });
});
