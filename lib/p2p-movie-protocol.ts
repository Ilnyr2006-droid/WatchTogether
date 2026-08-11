export const MOVIE_CHUNK_BYTES = 60 * 1024;
export const MOVIE_BUFFER_HIGH_WATER = 512 * 1024;
export const MOVIE_BUFFER_LOW_WATER = 128 * 1024;
const MAGIC = 0x57545032;
const HEADER_BYTES = 16;

export type MovieControlMessage =
  | { type: "request"; requestId: number; start: number; ahead: number }
  | { type: "cancel"; requestId: number }
  | {
      type: "transfer";
      requestId: number;
      transferId: number;
      kind: "init" | "media";
      start: number;
      end: number;
      bytes: number;
    }
  | { type: "window-complete"; requestId: number; end: number }
  | { type: "ready" }
  | { type: "error"; message: string };

export function parseMovieControlMessage(
  value: unknown,
): MovieControlMessage | null {
  if (typeof value !== "string" || value.length > 2048) return null;
  try {
    const parsed = JSON.parse(value) as Record<string, unknown>;
    if (parsed.type === "ready") return { type: "ready" };
    if (
      parsed.type === "error" &&
      typeof parsed.message === "string" &&
      parsed.message.length <= 300
    )
      return { type: "error", message: parsed.message };
    if (
      (parsed.type === "request" || parsed.type === "cancel") &&
      Number.isInteger(parsed.requestId) &&
      Number(parsed.requestId) >= 0
    ) {
      if (parsed.type === "cancel")
        return { type: "cancel", requestId: Number(parsed.requestId) };
      if (
        typeof parsed.start === "number" &&
        Number.isFinite(parsed.start) &&
        parsed.start >= 0 &&
        typeof parsed.ahead === "number" &&
        parsed.ahead >= 2 &&
        parsed.ahead <= 30
      ) {
        return {
          type: "request",
          requestId: Number(parsed.requestId),
          start: parsed.start,
          ahead: parsed.ahead,
        };
      }
    }
    if (
      parsed.type === "window-complete" &&
      Number.isInteger(parsed.requestId) &&
      typeof parsed.end === "number" &&
      Number.isFinite(parsed.end)
    )
      return {
        type: "window-complete",
        requestId: Number(parsed.requestId),
        end: parsed.end,
      };
    if (
      parsed.type === "transfer" &&
      Number.isInteger(parsed.requestId) &&
      Number.isInteger(parsed.transferId) &&
      (parsed.kind === "init" || parsed.kind === "media") &&
      typeof parsed.start === "number" &&
      typeof parsed.end === "number" &&
      Number.isInteger(parsed.bytes) &&
      Number(parsed.bytes) >= 0 &&
      Number(parsed.bytes) <= 128 * 1024 * 1024
    ) {
      return {
        type: "transfer",
        requestId: Number(parsed.requestId),
        transferId: Number(parsed.transferId),
        kind: parsed.kind,
        start: parsed.start,
        end: parsed.end,
        bytes: Number(parsed.bytes),
      };
    }
  } catch {
    /* invalid control packet */
  }
  return null;
}

export function encodeMovieChunks(
  data: ArrayBuffer,
  transferId: number,
  chunkBytes = MOVIE_CHUNK_BYTES,
) {
  if (
    !Number.isInteger(transferId) ||
    transferId < 0 ||
    chunkBytes < 1024 ||
    chunkBytes > 64 * 1024
  )
    throw new Error("Invalid movie chunk options");
  const count = Math.max(1, Math.ceil(data.byteLength / chunkBytes));
  const chunks: ArrayBuffer[] = [];
  for (let index = 0; index < count; index += 1) {
    const payload = data.slice(
      index * chunkBytes,
      Math.min(data.byteLength, (index + 1) * chunkBytes),
    );
    const packet = new ArrayBuffer(HEADER_BYTES + payload.byteLength);
    const view = new DataView(packet);
    view.setUint32(0, MAGIC);
    view.setUint32(4, transferId);
    view.setUint32(8, index);
    view.setUint32(12, count);
    new Uint8Array(packet, HEADER_BYTES).set(new Uint8Array(payload));
    chunks.push(packet);
  }
  return chunks;
}

interface Assembly {
  chunks: Array<ArrayBuffer | undefined>;
  received: number;
  bytes: number;
}

export class MovieChunkAssembler {
  private readonly pending = new Map<number, Assembly>();

  push(packet: ArrayBuffer): { transferId: number; data: ArrayBuffer } | null {
    if (
      packet.byteLength < HEADER_BYTES ||
      packet.byteLength > HEADER_BYTES + 64 * 1024
    )
      return null;
    const view = new DataView(packet);
    if (view.getUint32(0) !== MAGIC) return null;
    const transferId = view.getUint32(4);
    const index = view.getUint32(8);
    const count = view.getUint32(12);
    if (!count || count > 4096 || index >= count) return null;
    const assembly = this.pending.get(transferId) ?? {
      chunks: new Array<ArrayBuffer | undefined>(count),
      received: 0,
      bytes: 0,
    };
    if (assembly.chunks.length !== count) {
      this.pending.delete(transferId);
      return null;
    }
    if (!assembly.chunks[index]) {
      const payload = packet.slice(HEADER_BYTES);
      assembly.chunks[index] = payload;
      assembly.received += 1;
      assembly.bytes += payload.byteLength;
      if (assembly.bytes > 128 * 1024 * 1024) {
        this.pending.delete(transferId);
        return null;
      }
    }
    this.pending.set(transferId, assembly);
    if (assembly.received !== count) return null;
    const output = new Uint8Array(assembly.bytes);
    let offset = 0;
    for (const chunk of assembly.chunks) {
      if (!chunk) return null;
      output.set(new Uint8Array(chunk), offset);
      offset += chunk.byteLength;
    }
    this.pending.delete(transferId);
    return { transferId, data: output.buffer };
  }

  clear() {
    this.pending.clear();
  }
}

export function bufferedSeconds(video: HTMLVideoElement) {
  const time = video.currentTime;
  for (let index = 0; index < video.buffered.length; index += 1) {
    if (
      video.buffered.start(index) <= time + 0.25 &&
      video.buffered.end(index) >= time
    )
      return Math.max(0, video.buffered.end(index) - time);
  }
  return 0;
}

export async function sendMovieChunks(
  channel: RTCDataChannel,
  chunks: ArrayBuffer[],
  signal?: AbortSignal,
) {
  channel.bufferedAmountLowThreshold = MOVIE_BUFFER_LOW_WATER;
  for (const chunk of chunks) {
    if (signal?.aborted)
      throw new DOMException("Transfer cancelled", "AbortError");
    if (channel.readyState !== "open")
      throw new Error("P2P movie channel is closed");
    while (channel.bufferedAmount > MOVIE_BUFFER_HIGH_WATER)
      await waitForLowBuffer(channel, signal);
    channel.send(chunk);
  }
}

export async function waitForMovieDrain(
  channel: RTCDataChannel,
  signal?: AbortSignal,
) {
  channel.bufferedAmountLowThreshold = MOVIE_BUFFER_LOW_WATER;
  if (channel.bufferedAmount > MOVIE_BUFFER_LOW_WATER)
    await waitForLowBuffer(channel, signal);
}

function waitForLowBuffer(channel: RTCDataChannel, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const timeout = window.setTimeout(
      () => finish(new Error("P2P movie channel is congested")),
      10_000,
    );
    const onLow = () => finish();
    const onAbort = () =>
      finish(new DOMException("Transfer cancelled", "AbortError"));
    const finish = (error?: Error) => {
      window.clearTimeout(timeout);
      channel.removeEventListener("bufferedamountlow", onLow);
      signal?.removeEventListener("abort", onAbort);
      if (error) reject(error);
      else resolve();
    };
    channel.addEventListener("bufferedamountlow", onLow, { once: true });
    signal?.addEventListener("abort", onAbort, { once: true });
    if (channel.bufferedAmount <= channel.bufferedAmountLowThreshold) finish();
  });
}
