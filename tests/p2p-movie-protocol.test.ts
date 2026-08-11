import { describe, expect, it } from "vitest";
import { encodeMovieChunks, MovieChunkAssembler, parseMovieControlMessage } from "@/lib/p2p-movie-protocol";

describe("P2P movie protocol", () => {
  it("splits binary media without JSON/base64 and restores it", () => {
    const input = Uint8Array.from({ length: 180_000 }, (_, index) => index % 251).buffer;
    const chunks = encodeMovieChunks(input, 42);
    expect(chunks.length).toBeGreaterThan(2);
    const assembler = new MovieChunkAssembler();
    let completed: ReturnType<MovieChunkAssembler["push"]> = null;
    for (const chunk of [...chunks].reverse()) completed = assembler.push(chunk) ?? completed;
    expect(completed?.transferId).toBe(42);
    expect(new Uint8Array(completed!.data)).toEqual(new Uint8Array(input));
  });

  it("validates and bounds control messages", () => {
    expect(parseMovieControlMessage(JSON.stringify({ type: "request", requestId: 1, start: 25, ahead: 12 }))).toEqual({ type: "request", requestId: 1, start: 25, ahead: 12 });
    expect(parseMovieControlMessage(JSON.stringify({ type: "request", requestId: 1, start: -1, ahead: 999 }))).toBeNull();
    expect(parseMovieControlMessage("x".repeat(2049))).toBeNull();
  });

  it("rejects malformed binary packets", () => {
    const assembler = new MovieChunkAssembler();
    expect(assembler.push(new ArrayBuffer(15))).toBeNull();
    expect(assembler.push(new ArrayBuffer(32))).toBeNull();
  });
});
