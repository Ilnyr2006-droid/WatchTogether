import {
  createFile,
  type ISOFile,
  type Movie,
  type MP4BoxBuffer,
  type Track,
} from "mp4box";
import type { P2PMovieSourceInput } from "@/types/realtime";

const READ_BYTES = 1024 * 1024;
const SEGMENT_SECONDS = 4;

export interface MovieWindow {
  start: number;
  end: number;
  fragments: ArrayBuffer[];
}

function withFileStart(buffer: ArrayBuffer, fileStart: number) {
  return Object.assign(buffer, { fileStart }) as MP4BoxBuffer;
}

async function appendSlice<T>(
  file: File,
  iso: ISOFile<T, unknown>,
  offset: number,
) {
  const end = Math.min(file.size, offset + READ_BYTES);
  const buffer = withFileStart(
    await file.slice(offset, end).arrayBuffer(),
    offset,
  );
  const next = iso.appendBuffer(buffer);
  return { end, next: Number.isFinite(next) ? next : end };
}

async function openMp4(file: File) {
  const iso = createFile(false);
  let info: Movie | null = null;
  let parserError = "";
  iso.onReady = (value) => {
    info = value;
  };
  iso.onError = (_module, message) => {
    parserError = message;
  };
  let offset = 0;
  let iterations = 0;
  while (!info && offset < file.size && iterations < 256) {
    const result = await appendSlice(file, iso, offset);
    offset = result.next > offset ? result.next : result.end;
    iterations += 1;
  }
  if (!info && offset >= file.size) iso.flush();
  if (!info) throw new Error(parserError || "MP4 metadata не найдены");
  return { iso, info: info as Movie };
}

function supportedTracks(info: Movie) {
  const video = info.videoTracks[0];
  const audio = info.audioTracks[0];
  if (!video || !/^avc[13]\./i.test(video.codec))
    throw new Error("Поддерживается только MP4 с H.264 / AVC");
  if (audio && !/^mp4a\.40\./i.test(audio.codec))
    throw new Error("Аудиодорожка должна использовать AAC");
  const tracks = [video, ...(audio ? [audio] : [])];
  const codecs = tracks.map((track) => track.codec);
  const mimeCodec = `video/mp4; codecs="${codecs.join(",")}"`;
  if (
    typeof MediaSource !== "undefined" &&
    !MediaSource.isTypeSupported(mimeCodec)
  )
    throw new Error("Браузер не поддерживает кодеки этого MP4");
  return { video, tracks, codecs, mimeCodec };
}

export async function inspectP2PMovie(
  file: File,
): Promise<P2PMovieSourceInput> {
  if (!/\.mp4$/i.test(file.name) && file.type !== "video/mp4")
    throw new Error(
      "Этот формат нельзя воспроизвести напрямую в браузере. Требуется конвертация в MP4 H.264/AVC + AAC.",
    );
  const { iso, info } = await openMp4(file);
  const { video, codecs, mimeCodec } = supportedTracks(info);
  iso.stop();
  return {
    fileName: file.name.slice(0, 180),
    size: file.size,
    duration: info.duration / info.timescale,
    mimeCodec,
    codecs,
    width: video.video?.width ?? null,
    height: video.video?.height ?? null,
    sourceId: crypto.randomUUID().replaceAll("-", ""),
  };
}

export class Mp4FileSegmenter {
  private iso: ISOFile<number, unknown> | null = null;
  private info: Movie | null = null;
  private tracks: Track[] = [];
  private initSegment: ArrayBuffer | null = null;
  private busy = false;

  constructor(private readonly file: File) {}

  async initialize() {
    if (this.initSegment && this.info)
      return {
        initSegment: this.initSegment,
        duration: this.info.duration / this.info.timescale,
      };
    const opened = await openMp4(this.file);
    this.iso = opened.iso as ISOFile<number, unknown>;
    this.info = opened.info;
    const supported = supportedTracks(opened.info);
    this.tracks = supported.tracks;
    const samplesPerSecond =
      supported.video.nb_samples /
      Math.max(0.001, supported.video.duration / supported.video.timescale);
    const samplesPerSegment = Math.max(
      1,
      Math.round(samplesPerSecond * SEGMENT_SECONDS),
    );
    for (const track of this.tracks) {
      this.iso.setSegmentOptions(track.id, track.id, {
        nbSamples: samplesPerSegment,
        rapAlignement: true,
      });
    }
    this.initSegment = this.iso.initializeSegmentation("combined").buffer;
    this.iso.stop();
    return {
      initSegment: this.initSegment,
      duration: opened.info.duration / opened.info.timescale,
    };
  }

  async readWindow(
    start: number,
    ahead: number,
    signal?: AbortSignal,
  ): Promise<MovieWindow> {
    if (this.busy) throw new Error("Предыдущий P2P-запрос ещё обрабатывается");
    this.busy = true;
    try {
      await this.initialize();
      const iso = this.iso!;
      const target = Math.min(
        this.info!.duration / this.info!.timescale,
        Math.max(0, start) + Math.min(30, ahead),
      );
      const seek = iso.seek(Math.max(0, start), true);
      const fragments: ArrayBuffer[] = [];
      const progress = new Map<number, number>();
      let producedBytes = 0;
      iso.onSegment = (trackId, _user, buffer, nextSample) => {
        if (signal?.aborted) return;
        fragments.push(buffer);
        producedBytes += buffer.byteLength;
        const track = this.tracks.find((item) => item.id === trackId);
        if (track)
          progress.set(
            trackId,
            (nextSample / track.nb_samples) *
              (track.duration / track.timescale),
          );
        iso.releaseUsedSamples(trackId, nextSample);
      };
      iso.start();
      let offset = seek.offset;
      let iterations = 0;
      while (!signal?.aborted && offset < this.file.size && iterations < 256) {
        const result = await appendSlice(this.file, iso, offset);
        offset = result.next > offset ? result.next : result.end;
        iterations += 1;
        const allReady = this.tracks.every(
          (track) => (progress.get(track.id) ?? 0) >= target,
        );
        if (allReady || producedBytes >= 64 * 1024 * 1024) break;
      }
      iso.stop();
      iso.onSegment = undefined;
      if (signal?.aborted)
        throw new DOMException("Transfer cancelled", "AbortError");
      if (!fragments.length)
        throw new Error(
          "Не удалось получить MP4-сегмент для выбранной позиции",
        );
      const end = Math.max(seek.time, ...progress.values());
      return { start: seek.time, end, fragments };
    } finally {
      this.busy = false;
    }
  }
}
