import { describe, expect, it } from "vitest";
import { buildRutubeEmbedUrl, parseRutubeUrl, parseSubmittedVideoUrl } from "@/lib/video-source";

describe("RUTUBE URL parser", () => {
  it.each([
    "https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/",
    "https://rutube.ru/shorts/7716bd3e665725c3c008ae7ab4ff02e2/?t=10",
    "https://rutube.ru/play/embed/7716bd3e665725c3c008ae7ab4ff02e2",
  ])("extracts an id from %s", (url) => {
    expect(parseRutubeUrl(url)?.videoId).toBe("7716bd3e665725c3c008ae7ab4ff02e2");
  });

  it("preserves only a validated private access key", () => {
    const source = parseRutubeUrl("https://rutube.ru/video/7716bd3e665725c3c008ae7ab4ff02e2/?p=private_Key-42&utm=x");
    expect(source?.accessKey).toBe("private_Key-42");
    expect(source?.originalUrl).not.toContain("private_Key-42");
    expect(source && buildRutubeEmbedUrl(source)).toContain("p=private_Key-42");
  });

  it("rejects deceptive hosts, arbitrary paths and unsafe schemes", () => {
    expect(parseRutubeUrl("https://rutube.ru.evil.example/video/7716bd3e665725c3c008ae7ab4ff02e2/")).toBeNull();
    expect(parseRutubeUrl("javascript:alert(1)")).toBeNull();
    expect(parseRutubeUrl("https://rutube.ru/channel/7716bd3e665725c3c008ae7ab4ff02e2/")).toBeNull();
  });

  it("keeps direct HTML5 video support", () => {
    expect(parseSubmittedVideoUrl("https://cdn.example.com/movie.webm?token=x")).toEqual({ provider: "html5", mode: "url", url: "https://cdn.example.com/movie.webm?token=x" });
  });
});
