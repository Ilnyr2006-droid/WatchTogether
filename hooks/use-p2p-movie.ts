"use client";

import { RefObject, useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { Mp4FileSegmenter } from "@/lib/mp4-file-segmenter";
import {
  bufferedSeconds,
  encodeMovieChunks,
  MovieChunkAssembler,
  parseMovieControlMessage,
  sendMovieChunks,
  waitForMovieDrain,
  type MovieControlMessage,
} from "@/lib/p2p-movie-protocol";
import {
  decideIncomingDescription,
  IceCandidateQueue,
  isPolitePeer,
} from "@/lib/webrtc-negotiation";
import type {
  ClientToServerEvents,
  Participant,
  ServerToClientEvents,
  VideoSource,
} from "@/types/realtime";

type P2PSource = Extract<VideoSource, { provider: "html5"; mode: "p2p-movie" }>;
type P2PState = "connecting" | "buffering" | "ready" | "failed";
interface TransferDescriptor {
  requestId: number;
  kind: "init" | "media";
  start: number;
  end: number;
  bytes: number;
}
interface PeerContext {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  candidates: IceCandidateQueue<RTCIceCandidateInit>;
  control?: RTCDataChannel;
  data?: RTCDataChannel;
  segmenter?: Mp4FileSegmenter;
  abort?: AbortController;
  transferId: number;
  sentInit: boolean;
  disconnectTimer?: number;
}

const FALLBACK_ICE: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];

async function sendTransfer(
  context: PeerContext,
  requestId: number,
  kind: "init" | "media",
  start: number,
  end: number,
  data: ArrayBuffer,
  signal: AbortSignal,
) {
  const transferId = ++context.transferId;
  context.control?.send(JSON.stringify({ type: "transfer", requestId, transferId, kind, start, end, bytes: data.byteLength } satisfies MovieControlMessage));
  await sendMovieChunks(context.data!, encodeMovieChunks(data, transferId), signal);
}

export function useP2PMovie({
  socket,
  isHost,
  hostId,
  participants,
  source,
  file,
  videoRef,
}: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  isHost: boolean;
  participants: Participant[];
  hostId: string;
  source: P2PSource;
  file: File | null;
  videoRef: RefObject<HTMLVideoElement | null>;
}) {
  const peers = useRef(new Map<string, PeerContext>());
  const iceServers = useRef(FALLBACK_ICE);
  const mediaSourceRef = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const appendQueue = useRef<Array<ArrayBuffer>>([]);
  const assembler = useRef(new MovieChunkAssembler());
  const descriptors = useRef(new Map<number, TransferDescriptor>());
  const activeRequest = useRef(0);
  const pendingRequest = useRef(false);
  const objectUrl = useRef<string | null>(null);
  const bytesReceived = useRef(0);
  const speedSample = useRef({ bytes: 0, at: 0 });
  const [state, setState] = useState<P2PState>("connecting");
  const [error, setError] = useState("");
  const [buffer, setBuffer] = useState(0);
  const [speedMbps, setSpeedMbps] = useState(0);
  const [transferredBytes, setTransferredBytes] = useState(0);
  const [route, setRoute] = useState<"DIRECT" | "TURN" | "—">("—");

  const processAppendQueue = useCallback(() => {
    const sb = sourceBufferRef.current;
    if (
      !sb ||
      sb.updating ||
      !appendQueue.current.length ||
      mediaSourceRef.current?.readyState !== "open"
    )
      return;
    const next = appendQueue.current.shift();
    if (!next) return;
    try {
      sb.appendBuffer(next);
    } catch (caught) {
      setState("failed");
      setError(caught instanceof Error ? caught.message : "Ошибка MediaSource");
    }
  }, []);

  const requestWindow = useCallback(
    (start: number) => {
      if (isHost || pendingRequest.current) return;
      const host = participants.find(
        (participant) => participant.socketId === hostId,
      );
      const context = host ? peers.current.get(host.socketId) : undefined;
      if (
        !context?.control ||
        context.control.readyState !== "open" ||
        context.data?.readyState !== "open"
      )
        return;
      const previous = activeRequest.current;
      activeRequest.current += 1;
      pendingRequest.current = true;
      if (previous)
        context.control.send(
          JSON.stringify({
            type: "cancel",
            requestId: previous,
          } satisfies MovieControlMessage),
        );
      context.control.send(
        JSON.stringify({
          type: "request",
          requestId: activeRequest.current,
          start: Math.max(0, start),
          ahead: 12,
        } satisfies MovieControlMessage),
      );
      setState("buffering");
    },
    [hostId, isHost, participants],
  );

  const handleControl = useCallback(
    async (context: PeerContext, raw: unknown) => {
      const message = parseMovieControlMessage(raw);
      if (!message) return;
      if (isHost) {
        if (message.type === "cancel") {
          context.abort?.abort();
          return;
        }
        if (
          message.type !== "request" ||
          !file ||
          !context.data ||
          context.data.readyState !== "open"
        )
          return;
        context.abort?.abort();
        const abort = new AbortController();
        context.abort = abort;
        try {
          context.segmenter ??= new Mp4FileSegmenter(file);
          const initialized = await context.segmenter.initialize();
          if (!context.sentInit) {
            await sendTransfer(
              context,
              message.requestId,
              "init",
              0,
              0,
              initialized.initSegment,
              abort.signal,
            );
            context.sentInit = true;
          }
          const window = await context.segmenter.readWindow(
            message.start,
            message.ahead,
            abort.signal,
          );
          for (const fragment of window.fragments)
            await sendTransfer(
              context,
              message.requestId,
              "media",
              window.start,
              window.end,
              fragment,
              abort.signal,
            );
          await waitForMovieDrain(context.data, abort.signal);
          context.control?.send(
            JSON.stringify({
              type: "window-complete",
              requestId: message.requestId,
              end: window.end,
            } satisfies MovieControlMessage),
          );
        } catch (caught) {
          if (!abort.signal.aborted)
            context.control?.send(
              JSON.stringify({
                type: "error",
                message:
                  caught instanceof Error
                    ? caught.message
                    : "Ошибка P2P-сегментации",
              } satisfies MovieControlMessage),
            );
        }
        return;
      }
      if (message.type === "transfer")
        descriptors.current.set(message.transferId, message);
      if (
        message.type === "window-complete" &&
        message.requestId === activeRequest.current
      )
        pendingRequest.current = false;
      if (message.type === "error") {
        pendingRequest.current = false;
        setState("failed");
        setError(message.message);
      }
    },
    [file, isHost],
  );

  const bindChannel = useCallback(
    (context: PeerContext, channel: RTCDataChannel) => {
      if (channel.label === "movie-control") {
        context.control = channel;
        channel.onmessage = (event) => {
          void handleControl(context, event.data);
        };
        channel.onopen = () => {
          if (!isHost && context.data?.readyState === "open")
            requestWindow(videoRef.current?.currentTime ?? 0);
        };
      } else if (channel.label === "movie-data") {
        context.data = channel;
        channel.binaryType = "arraybuffer";
        channel.onopen = () => {
          if (!isHost && context.control?.readyState === "open")
            requestWindow(videoRef.current?.currentTime ?? 0);
        };
        channel.onmessage = (event) => {
          if (!(event.data instanceof ArrayBuffer)) return;
          bytesReceived.current += event.data.byteLength;
          const completed = assembler.current.push(event.data);
          if (!completed) return;
          const descriptor = descriptors.current.get(completed.transferId);
          descriptors.current.delete(completed.transferId);
          if (
            !descriptor ||
            descriptor.requestId !== activeRequest.current ||
            descriptor.bytes !== completed.data.byteLength
          )
            return;
          appendQueue.current.push(completed.data);
          processAppendQueue();
        };
      }
    },
    [handleControl, isHost, processAppendQueue, requestWindow, videoRef],
  );

  const negotiate = useCallback(
    async (context: PeerContext) => {
      if (context.makingOffer || context.pc.signalingState === "closed") return;
      try {
        context.makingOffer = true;
        await context.pc.setLocalDescription();
        if (context.pc.localDescription)
          socket.emit("movie:offer", {
            to: context.id,
            description: context.pc.localDescription.toJSON(),
          });
      } catch {
        setState("failed");
      } finally {
        context.makingOffer = false;
      }
    },
    [socket],
  );

  const cleanupPeer = useCallback((id: string) => {
    const context = peers.current.get(id);
    if (!context) return;
    peers.current.delete(id);
    context.abort?.abort();
    if (context.disconnectTimer) window.clearTimeout(context.disconnectTimer);
    context.control?.close();
    context.data?.close();
    context.pc.close();
  }, []);

  const createPeer = useCallback(
    (id: string) => {
      const existing = peers.current.get(id);
      if (existing) return existing;
      const pc = new RTCPeerConnection({
        iceServers: iceServers.current,
        iceCandidatePoolSize: 2,
      });
      const context: PeerContext = {
        id,
        pc,
        polite: isPolitePeer(socket.id || "", id),
        makingOffer: false,
        ignoreOffer: false,
        isSettingRemoteAnswerPending: false,
        candidates: new IceCandidateQueue<RTCIceCandidateInit>(),
        transferId: 0,
        sentInit: false,
      };
      peers.current.set(id, context);
      if (isHost) {
        bindChannel(
          context,
          pc.createDataChannel("movie-control", { ordered: true }),
        );
        bindChannel(
          context,
          pc.createDataChannel("movie-data", { ordered: true }),
        );
      } else pc.ondatachannel = ({ channel }) => bindChannel(context, channel);
      pc.onicecandidate = ({ candidate }) => {
        if (candidate)
          socket.emit("movie:ice-candidate", {
            to: id,
            candidate: candidate.toJSON(),
          });
      };
      pc.onnegotiationneeded = () => {
        void negotiate(context);
      };
      pc.onconnectionstatechange = () => {
        if (pc.connectionState === "connected") {
          if (context.disconnectTimer)
            window.clearTimeout(context.disconnectTimer);
          setState(isHost ? "ready" : "buffering");
        }
        if (
          pc.connectionState === "disconnected" ||
          pc.connectionState === "failed"
        ) {
          setState("connecting");
          if (!context.disconnectTimer)
            context.disconnectTimer = window.setTimeout(() => {
              context.disconnectTimer = undefined;
              if (pc.signalingState !== "closed") {
                pc.restartIce();
                void negotiate(context);
              }
            }, 3_000);
        }
      };
      return context;
    },
    [bindChannel, isHost, negotiate, socket],
  );

  useEffect(() => {
    void fetch("/api/ice-servers", { cache: "no-store" })
      .then((response) => response.json())
      .then((body: { iceServers?: RTCIceServer[] }) => {
        if (body.iceServers?.length) iceServers.current = body.iceServers;
      })
      .catch(() => undefined);
  }, []);

  useEffect(() => {
    const description = async ({
      from,
      description: incoming,
    }: {
      from: string;
      description: RTCSessionDescriptionInit;
    }) => {
      const context = peers.current.get(from) ?? createPeer(from);
      try {
        const decision = decideIncomingDescription(
          context,
          context.pc.signalingState,
          incoming.type!,
        );
        context.ignoreOffer = decision.ignoreOffer;
        if (context.ignoreOffer) return;
        if (
          decision.offerCollision &&
          context.polite &&
          context.pc.signalingState !== "stable"
        )
          await context.pc.setLocalDescription({ type: "rollback" });
        context.isSettingRemoteAnswerPending = incoming.type === "answer";
        await context.pc.setRemoteDescription(incoming);
        context.isSettingRemoteAnswerPending = false;
        await context.candidates.flush((candidate) =>
          context.pc.addIceCandidate(candidate),
        );
        if (incoming.type === "offer") {
          await context.pc.setLocalDescription();
          if (context.pc.localDescription)
            socket.emit("movie:answer", {
              to: from,
              description: context.pc.localDescription.toJSON(),
            });
        }
      } catch {
        context.isSettingRemoteAnswerPending = false;
        if (!context.ignoreOffer) setState("failed");
      }
    };
    const offer = (payload: {
      from: string;
      description: RTCSessionDescriptionInit;
    }) => {
      void description(payload);
    };
    const answer = (payload: {
      from: string;
      description: RTCSessionDescriptionInit;
    }) => {
      void description(payload);
    };
    const candidate = ({
      from,
      candidate: value,
    }: {
      from: string;
      candidate: RTCIceCandidateInit;
    }) => {
      const context = peers.current.get(from) ?? createPeer(from);
      if (!context.pc.remoteDescription) context.candidates.enqueue(value);
      else void context.pc.addIceCandidate(value);
    };
    socket.on("movie:offer", offer);
    socket.on("movie:answer", answer);
    socket.on("movie:ice-candidate", candidate);
    return () => {
      socket.off("movie:offer", offer);
      socket.off("movie:answer", answer);
      socket.off("movie:ice-candidate", candidate);
    };
  }, [createPeer, socket]);

  useEffect(() => {
    const ids = new Set(
      participants
        .filter((participant) => participant.socketId !== socket.id)
        .map((participant) => participant.socketId),
    );
    peers.current.forEach((_context, id) => {
      if (!ids.has(id)) cleanupPeer(id);
    });
    if (isHost && file) ids.forEach((id) => createPeer(id));
    if (!isHost && hostId !== socket.id && ids.has(hostId)) createPeer(hostId);
  }, [cleanupPeer, createPeer, file, hostId, isHost, participants, socket.id]);

  useEffect(() => {
    if (isHost) return;
    const mediaSource = new MediaSource();
    const activeAssembler = assembler.current;
    mediaSourceRef.current = mediaSource;
    objectUrl.current = URL.createObjectURL(mediaSource);
    if (videoRef.current) videoRef.current.src = objectUrl.current;
    const open = () => {
      try {
        const sb = mediaSource.addSourceBuffer(source.mimeCodec);
        sourceBufferRef.current = sb;
        sb.mode = "segments";
        sb.addEventListener("updateend", processAppendQueue);
        processAppendQueue();
      } catch (caught) {
        setState("failed");
        setError(
          caught instanceof Error
            ? caught.message
            : "MediaSource не поддерживает кодеки",
        );
      }
    };
    mediaSource.addEventListener("sourceopen", open);
    return () => {
      mediaSource.removeEventListener("sourceopen", open);
      sourceBufferRef.current = null;
      appendQueue.current = [];
      activeAssembler.clear();
      if (objectUrl.current) URL.revokeObjectURL(objectUrl.current);
      objectUrl.current = null;
    };
  }, [isHost, processAppendQueue, source.mimeCodec, videoRef]);

  useEffect(() => {
    const video = videoRef.current;
    if (!video || isHost) return;
    const seek = () => {
      pendingRequest.current = false;
      appendQueue.current = [];
      assembler.current.clear();
      descriptors.current.clear();
      requestWindow(video.currentTime);
    };
    video.addEventListener("seeking", seek);
    return () => video.removeEventListener("seeking", seek);
  }, [isHost, requestWindow, videoRef]);

  useEffect(() => {
    const timer = window.setInterval(() => {
      const video = videoRef.current;
      if (!video) return;
      const seconds = isHost
        ? Math.max(0, video.duration - video.currentTime)
        : bufferedSeconds(video);
      setBuffer(seconds);
      const now = Date.now();
      const elapsed = (now - speedSample.current.at) / 1000;
      const delta = bytesReceived.current - speedSample.current.bytes;
      if (elapsed > 0) setSpeedMbps((delta * 8) / elapsed / 1_000_000);
      speedSample.current = { bytes: bytesReceived.current, at: now };
      setTransferredBytes(bytesReceived.current);
      if (!isHost && seconds < 20 && !pendingRequest.current) {
        let start = video.currentTime;
        if (video.buffered.length)
          start = Math.max(
            start,
            video.buffered.end(video.buffered.length - 1) - 0.2,
          );
        requestWindow(start);
      }
      if (!isHost && seconds >= 4) setState("ready");
      void collectRoute(peers.current).then(setRoute);
    }, 2_000);
    return () => window.clearInterval(timer);
  }, [isHost, requestWindow, videoRef]);

  useEffect(
    () => () => {
      peers.current.forEach((_context, id) => cleanupPeer(id));
    },
    [cleanupPeer],
  );
  return {
    state,
    error,
    bufferSeconds: buffer,
    speedMbps,
    transferredBytes,
    route,
  };
}

async function collectRoute(
  peers: Map<string, PeerContext>,
): Promise<"DIRECT" | "TURN" | "—"> {
  for (const { pc } of peers.values()) {
    try {
      const report = await pc.getStats();
      let pair:
        | (RTCStats & {
            state?: string;
            nominated?: boolean;
            localCandidateId?: string;
            remoteCandidateId?: string;
          })
        | undefined;
      report.forEach((item) => {
        const value = item as typeof pair;
        if (
          value?.type === "candidate-pair" &&
          value.state === "succeeded" &&
          value.nominated
        )
          pair = value;
      });
      if (pair) {
        const local = pair.localCandidateId
          ? (report.get(pair.localCandidateId) as
              | (RTCStats & { candidateType?: string })
              | undefined)
          : undefined;
        const remote = pair.remoteCandidateId
          ? (report.get(pair.remoteCandidateId) as
              | (RTCStats & { candidateType?: string })
              | undefined)
          : undefined;
        return local?.candidateType === "relay" ||
          remote?.candidateType === "relay"
          ? "TURN"
          : "DIRECT";
      }
    } catch {
      /* peer may close during stats */
    }
  }
  return "—";
}
