import { describe, expect, it } from "vitest";
import { inspectP2PMovie } from "@/lib/mp4-file-segmenter";

describe("P2P movie file validation", () => {
  it("explains that an MKV file requires conversion", async () => {
    const file = new File(["mkv"], "movie.mkv", {
      type: "video/x-matroska",
    });

    await expect(inspectP2PMovie(file)).rejects.toThrow(
      "Требуется конвертация в MP4 H.264/AVC + AAC",
    );
  });
});
