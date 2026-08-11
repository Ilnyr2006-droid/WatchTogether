"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Socket } from "socket.io-client";
import { IceCandidateQueue, decideIncomingDescription, isPolitePeer } from "@/lib/webrtc-negotiation";
import { reconcilePeerIds, recoveryAction } from "@/lib/webrtc-recovery";
import type { ClientToServerEvents, Participant, ServerToClientEvents, VoiceConnectionState, VoiceDiagnostic } from "@/types/realtime";

const FALLBACK_ICE_SERVERS: RTCIceServer[] = [{ urls: "stun:stun.l.google.com:19302" }];
const ENHANCED_AUDIO: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };

interface PeerContext {
  id: string;
  pc: RTCPeerConnection;
  polite: boolean;
  makingOffer: boolean;
  ignoreOffer: boolean;
  isSettingRemoteAnswerPending: boolean;
  pendingCandidates: IceCandidateQueue<RTCIceCandidateInit>;
  recoveryAttempts: number;
  recreations: number;
  disconnectTimer?: number;
  recoveryTimer?: number;
  audioElement?: HTMLAudioElement;
  remoteStream: MediaStream;
  stopSpeakingMonitor?: () => void;
}

interface IceServerApiResponse { iceServers?: RTCIceServer[]; expiresAt?: number | null }

async function requestMicrophone(deviceId?: string) {
  const selectedDevice = deviceId ? { deviceId: { exact: deviceId } } : {};
  const attempts: MediaStreamConstraints[] = [
    { audio: { ...ENHANCED_AUDIO, ...selectedDevice }, video: false },
    { audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true, ...selectedDevice }, video: false },
    { audio: deviceId ? selectedDevice : true, video: false },
  ];
  let lastError: unknown;
  for (const constraints of attempts) {
    try { return await navigator.mediaDevices.getUserMedia(constraints); }
    catch (error) {
      lastError = error;
      const name = error instanceof DOMException ? error.name : "";
      if (["NotAllowedError", "SecurityError", "AbortError"].includes(name)) throw error;
    }
  }
  throw lastError;
}

export function useVoiceChat(socket: Socket<ServerToClientEvents, ClientToServerEvents>, participants: Participant[]) {
  const streamRef = useRef<MediaStream | null>(null);
  const peersRef = useRef(new Map<string, PeerContext>());
  const participantsRef = useRef(participants);
  const mutedRef = useRef(true);
  const iceServersRef = useRef<RTCIceServer[]>(FALLBACK_ICE_SERVERS);
  const iceExpiresAtRef = useRef<number | null>(null);
  const iceFetchRef = useRef<Promise<RTCIceServer[]> | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const localSpeakingCleanupRef = useRef<(() => void) | null>(null);
  const negotiateRef = useRef<((context: PeerContext, iceRestart?: boolean) => Promise<void>) | null>(null);
  const recoverRef = useRef<((context: PeerContext) => Promise<void>) | null>(null);
  const [muted, setMuted] = useState(true);
  const [hasMicrophone, setHasMicrophone] = useState(false);
  const [error, setError] = useState("");
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState("");
  const [peerStates, setPeerStates] = useState<Record<string, VoiceConnectionState>>({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});
  const [diagnostics, setDiagnostics] = useState<Record<string, VoiceDiagnostic>>({});
  const debug = process.env.NEXT_PUBLIC_WEBRTC_DEBUG === "true";

  useEffect(() => { participantsRef.current = participants; }, [participants]);

  const setPeerState = useCallback((peerId: string, state: VoiceConnectionState) => {
    setPeerStates((current) => current[peerId] === state ? current : { ...current, [peerId]: state });
  }, []);

  const loadIceServers = useCallback(async (force = false) => {
    const nowSeconds = Date.now() / 1000;
    if (!force && iceExpiresAtRef.current && iceExpiresAtRef.current - nowSeconds > 60) return iceServersRef.current;
    if (iceFetchRef.current) return iceFetchRef.current;
    iceFetchRef.current = fetch("/api/ice-servers", { cache: "no-store", credentials: "same-origin" })
      .then(async (response) => {
        if (!response.ok) throw new Error("ICE configuration unavailable");
        const data = await response.json() as IceServerApiResponse;
        if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) throw new Error("Invalid ICE configuration");
        iceServersRef.current = data.iceServers;
        iceExpiresAtRef.current = typeof data.expiresAt === "number" ? data.expiresAt : null;
        return data.iceServers;
      })
      .catch(() => { iceServersRef.current = FALLBACK_ICE_SERVERS; return FALLBACK_ICE_SERVERS; })
      .finally(() => { iceFetchRef.current = null; });
    return iceFetchRef.current;
  }, []);

  const startSpeakingMonitor = useCallback((stream: MediaStream, key: string) => {
    if (!stream.getAudioTracks().length) return () => undefined;
    const AudioContextCtor = window.AudioContext;
    const context = audioContextRef.current ?? new AudioContextCtor();
    audioContextRef.current = context;
    if (context.state === "suspended") void context.resume();
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    analyser.smoothingTimeConstant = 0.65;
    source.connect(analyser);
    const samples = new Uint8Array(analyser.fftSize);
    let last = false;
    const timer = window.setInterval(() => {
      analyser.getByteTimeDomainData(samples);
      let energy = 0;
      for (const sample of samples) { const normalized = (sample - 128) / 128; energy += normalized * normalized; }
      const active = Math.sqrt(energy / samples.length) > 0.035;
      if (active !== last) { last = active; setSpeaking((current) => ({ ...current, [key]: active })); }
    }, 180);
    return () => {
      window.clearInterval(timer); source.disconnect(); analyser.disconnect();
      setSpeaking((current) => { const next = { ...current }; delete next[key]; return next; });
    };
  }, []);

  const cleanupPeer = useCallback((peerId: string, preserveStatus = false) => {
    const context = peersRef.current.get(peerId);
    if (!context) return;
    peersRef.current.delete(peerId);
    if (context.disconnectTimer) window.clearTimeout(context.disconnectTimer);
    if (context.recoveryTimer) window.clearTimeout(context.recoveryTimer);
    context.stopSpeakingMonitor?.();
    context.pc.onicecandidate = null; context.pc.ontrack = null; context.pc.onnegotiationneeded = null; context.pc.onconnectionstatechange = null;
    context.pc.close();
    context.remoteStream.getTracks().forEach((track) => track.stop());
    if (context.audioElement) { context.audioElement.pause(); context.audioElement.srcObject = null; context.audioElement.remove(); }
    if (!preserveStatus) {
      setPeerStates((current) => { const next = { ...current }; delete next[peerId]; return next; });
      setDiagnostics((current) => { const next = { ...current }; delete next[peerId]; return next; });
    }
  }, []);

  const negotiate = useCallback(async (context: PeerContext, iceRestart = false) => {
    if (context.pc.signalingState === "closed" || context.makingOffer) return;
    try {
      context.makingOffer = true;
      const offer = await context.pc.createOffer(iceRestart ? { iceRestart: true } : undefined);
      if (context.pc.signalingState !== "stable") return;
      await context.pc.setLocalDescription(offer);
      if (context.pc.localDescription?.type === "offer") socket.emit("webrtc:offer", { to: context.id, description: context.pc.localDescription.toJSON() });
    } catch { setPeerState(context.id, "failed"); }
    finally { context.makingOffer = false; }
  }, [setPeerState, socket]);
  useEffect(() => { negotiateRef.current = negotiate; }, [negotiate]);

  const createPeer = useCallback((peerId: string, recreations = 0) => {
    const existing = peersRef.current.get(peerId);
    if (existing) return existing;
    const pc = new RTCPeerConnection({ iceServers: iceServersRef.current, iceCandidatePoolSize: 4, bundlePolicy: "max-bundle" });
    const context: PeerContext = {
      id: peerId, pc, polite: isPolitePeer(socket.id || "", peerId), makingOffer: false, ignoreOffer: false,
      isSettingRemoteAnswerPending: false, pendingCandidates: new IceCandidateQueue(), recoveryAttempts: 0,
      recreations, remoteStream: new MediaStream(),
    };
    peersRef.current.set(peerId, context);
    setPeerState(peerId, "connecting");

    const localTrack = streamRef.current?.getAudioTracks()[0];
    if (localTrack && streamRef.current) pc.addTrack(localTrack, streamRef.current);
    pc.onicecandidate = ({ candidate }) => { if (candidate) socket.emit("webrtc:ice-candidate", { to: peerId, candidate: candidate.toJSON() }); };
    pc.onnegotiationneeded = () => { void negotiateRef.current?.(context); };
    pc.ontrack = ({ track }) => {
      if (track.kind !== "audio" || context.remoteStream.getTracks().some((item) => item.id === track.id)) return;
      context.remoteStream.addTrack(track);
      if (!context.audioElement) {
        const audio = document.createElement("audio");
        audio.id = `voice-${peerId}`; audio.dataset.peerId = peerId; audio.autoplay = true; audio.setAttribute("playsinline", "");
        audio.srcObject = context.remoteStream; document.body.appendChild(audio); context.audioElement = audio;
        void audio.play().catch(() => undefined);
      }
      if (!context.stopSpeakingMonitor) context.stopSpeakingMonitor = startSpeakingMonitor(context.remoteStream, peerId);
    };
    pc.onconnectionstatechange = () => {
      if (peersRef.current.get(peerId) !== context) return;
      const state = pc.connectionState;
      if (state === "connected") {
        if (context.disconnectTimer) window.clearTimeout(context.disconnectTimer);
        if (context.recoveryTimer) window.clearTimeout(context.recoveryTimer);
        context.disconnectTimer = undefined; context.recoveryTimer = undefined; context.recoveryAttempts = 0; context.recreations = 0;
        setPeerState(peerId, "connected");
      } else if (state === "connecting" || state === "new") setPeerState(peerId, "connecting");
      else if (state === "disconnected") {
        setPeerState(peerId, "reconnecting");
        if (!context.disconnectTimer) context.disconnectTimer = window.setTimeout(() => { context.disconnectTimer = undefined; void recoverRef.current?.(context); }, 3_000);
      } else if (state === "failed") { setPeerState(peerId, "failed"); void recoverRef.current?.(context); }
    };
    return context;
  }, [setPeerState, socket, startSpeakingMonitor]);

  const recover = useCallback(async (context: PeerContext) => {
    if (peersRef.current.get(context.id) !== context || context.pc.connectionState === "connected") return;
    const action = recoveryAction("failed", context.recoveryAttempts, context.recreations);
    if (action === "restart-ice") {
      context.recoveryAttempts += 1; setPeerState(context.id, "reconnecting");
      context.pc.restartIce();
      context.recoveryTimer = window.setTimeout(() => { context.recoveryTimer = undefined; void recoverRef.current?.(context); }, 5_000);
    } else if (action === "recreate") {
      const nextRecreation = context.recreations + 1;
      cleanupPeer(context.id, true);
      createPeer(context.id, nextRecreation);
    } else setPeerState(context.id, "failed");
  }, [cleanupPeer, createPeer, setPeerState]);
  useEffect(() => { recoverRef.current = recover; }, [recover]);

  const ensurePeer = useCallback((peerId: string) => peersRef.current.get(peerId) ?? createPeer(peerId), [createPeer]);

  useEffect(() => {
    const handleDescription = async ({ from, description }: { from: string; description: RTCSessionDescriptionInit }) => {
      const context = ensurePeer(from);
      try {
        const decision = decideIncomingDescription(context, context.pc.signalingState, description.type!);
        context.ignoreOffer = decision.ignoreOffer;
        if (context.ignoreOffer) { context.pendingCandidates.clear(); return; }
        if (decision.offerCollision && context.polite && context.pc.signalingState !== "stable") await context.pc.setLocalDescription({ type: "rollback" });
        context.isSettingRemoteAnswerPending = description.type === "answer";
        await context.pc.setRemoteDescription(description);
        context.isSettingRemoteAnswerPending = false;
        await context.pendingCandidates.flush((candidate) => context.pc.addIceCandidate(candidate));
        if (description.type === "offer") {
          const answer = await context.pc.createAnswer();
          await context.pc.setLocalDescription(answer);
          if (context.pc.localDescription) socket.emit("webrtc:answer", { to: from, description: context.pc.localDescription.toJSON() });
        }
      } catch {
        context.isSettingRemoteAnswerPending = false;
        if (!context.ignoreOffer) { setPeerState(from, "failed"); setError("Не удалось согласовать голосовое соединение"); }
      }
    };
    const onOffer = (payload: { from: string; description: RTCSessionDescriptionInit }) => { void handleDescription(payload); };
    const onAnswer = (payload: { from: string; description: RTCSessionDescriptionInit }) => { void handleDescription(payload); };
    const onCandidate = ({ from, candidate }: { from: string; candidate: RTCIceCandidateInit }) => {
      const context = ensurePeer(from);
      if (context.ignoreOffer) return;
      if (!context.pc.remoteDescription) context.pendingCandidates.enqueue(candidate);
      else void context.pc.addIceCandidate(candidate).catch(() => { if (!context.ignoreOffer) setPeerState(from, "failed"); });
    };
    socket.on("webrtc:offer", onOffer); socket.on("webrtc:answer", onAnswer); socket.on("webrtc:ice-candidate", onCandidate);
    return () => { socket.off("webrtc:offer", onOffer); socket.off("webrtc:answer", onAnswer); socket.off("webrtc:ice-candidate", onCandidate); };
  }, [ensurePeer, setPeerState, socket]);

  useEffect(() => {
    const reconciliation = reconcilePeerIds(peersRef.current.keys(), participants.map((participant) => participant.socketId), socket.id);
    reconciliation.remove.forEach((id) => cleanupPeer(id));
    setPeerStates((current) => Object.fromEntries(Object.entries(current).filter(([id]) => reconciliation.active.has(id))));
    if (streamRef.current) reconciliation.create.forEach((id) => ensurePeer(id));
    if (streamRef.current && socket.connected && participants.some((participant) => participant.socketId === socket.id)) socket.emit("participant:update", { muted: mutedRef.current });
  }, [cleanupPeer, ensurePeer, participants, socket]);

  useEffect(() => {
    const cleanupAll = () => {
      peersRef.current.forEach((_, id) => cleanupPeer(id, true));
      setPeerStates(Object.fromEntries(participantsRef.current.filter((participant) => participant.socketId !== socket.id).map((participant) => [participant.socketId, "reconnecting" as const])));
    };
    const onDisconnect = () => { cleanupAll(); localSpeakingCleanupRef.current?.(); localSpeakingCleanupRef.current = null; };
    const onConnect = () => {
      cleanupAll();
      if (streamRef.current) localSpeakingCleanupRef.current = startSpeakingMonitor(streamRef.current, socket.id || "local");
    };
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    return () => { socket.off("disconnect", onDisconnect); socket.off("connect", onConnect); };
  }, [cleanupPeer, socket, startSpeakingMonitor]);

  const refreshDevices = useCallback(async () => {
    if (!navigator.mediaDevices?.enumerateDevices) return;
    const available = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
    setDevices(available);
  }, []);

  useEffect(() => {
    void loadIceServers();
    navigator.mediaDevices?.addEventListener?.("devicechange", refreshDevices);
    return () => navigator.mediaDevices?.removeEventListener?.("devicechange", refreshDevices);
  }, [loadIceServers, refreshDevices]);

  useEffect(() => {
    if (!debug) return;
    const collect = async () => {
      const next: Record<string, VoiceDiagnostic> = {};
      for (const [peerId, context] of peersRef.current) {
        try {
          const report = await context.pc.getStats();
          let pair: (RTCStats & { currentRoundTripTime?: number; localCandidateId?: string; remoteCandidateId?: string }) | undefined;
          let jitter: number | undefined; let packetsLost: number | undefined;
          report.forEach((item) => {
            const stats = item as RTCStats & { kind?: string; mediaType?: string; state?: string; nominated?: boolean; currentRoundTripTime?: number; localCandidateId?: string; remoteCandidateId?: string; jitter?: number; packetsLost?: number };
            if (stats.type === "candidate-pair" && stats.state === "succeeded" && stats.nominated) pair = stats;
            if (stats.type === "inbound-rtp" && (stats.kind === "audio" || stats.mediaType === "audio")) { jitter = stats.jitter; packetsLost = stats.packetsLost; }
          });
          const local = pair?.localCandidateId ? report.get(pair.localCandidateId) as (RTCStats & { candidateType?: string }) | undefined : undefined;
          const remote = pair?.remoteCandidateId ? report.get(pair.remoteCandidateId) as (RTCStats & { candidateType?: string }) | undefined : undefined;
          next[peerId] = { state: context.pc.connectionState, rttMs: pair?.currentRoundTripTime === undefined ? null : Math.round(pair.currentRoundTripTime * 1000), jitterMs: jitter === undefined ? null : Math.round(jitter * 1000), packetsLost: packetsLost ?? null, candidateType: local?.candidateType ?? remote?.candidateType ?? null, transport: local?.candidateType === "relay" || remote?.candidateType === "relay" ? "TURN" : "P2P" };
        } catch { /* A closed peer may disappear while stats are collected. */ }
      }
      setDiagnostics(next);
    };
    void collect();
    const timer = window.setInterval(() => { void collect(); }, 5_000);
    return () => window.clearInterval(timer);
  }, [debug]);

  const attachLocalStream = useCallback((stream: MediaStream) => {
    const track = stream.getAudioTracks()[0];
    if (!track) throw new Error("Audio track unavailable");
    track.enabled = !mutedRef.current;
    streamRef.current = stream;
    setHasMicrophone(true);
    localSpeakingCleanupRef.current?.();
    localSpeakingCleanupRef.current = startSpeakingMonitor(stream, socket.id || "local");
    peersRef.current.forEach((context) => {
      const sender = context.pc.getSenders().find((item) => item.track?.kind === "audio");
      if (sender) void sender.replaceTrack(track);
      else context.pc.addTrack(track, stream);
    });
    const actualDevice = track.getSettings().deviceId;
    if (actualDevice) setSelectedDeviceId(actualDevice);
  }, [socket.id, startSpeakingMonitor]);

  const toggle = useCallback(async () => {
    try {
      if (!streamRef.current) {
        await loadIceServers();
        const stream = await requestMicrophone(selectedDeviceId || undefined);
        attachLocalStream(stream);
        await refreshDevices();
        participantsRef.current.filter((participant) => participant.socketId !== socket.id).forEach((participant) => ensurePeer(participant.socketId));
      }
      const nextMuted = !mutedRef.current;
      mutedRef.current = nextMuted;
      const currentStream = streamRef.current;
      if (!currentStream) throw new Error("Microphone stream unavailable");
      currentStream.getAudioTracks().forEach((track) => { track.enabled = !nextMuted; });
      setMuted(nextMuted); setError("");
      socket.emit("participant:update", { muted: nextMuted });
    } catch { mutedRef.current = true; setMuted(true); setError("Микрофон недоступен. Проверьте разрешение браузера, устройство и HTTPS"); socket.emit("participant:update", { muted: true }); }
  }, [attachLocalStream, ensurePeer, loadIceServers, refreshDevices, selectedDeviceId, socket]);

  const selectDevice = useCallback(async (deviceId: string) => {
    try {
      const replacement = await requestMicrophone(deviceId);
      const previous = streamRef.current;
      attachLocalStream(replacement);
      previous?.getTracks().forEach((track) => track.stop());
      setSelectedDeviceId(deviceId); setError("");
    } catch { setError("Не удалось переключить микрофон"); }
  }, [attachLocalStream]);

  useEffect(() => () => {
    peersRef.current.forEach((_, id) => cleanupPeer(id));
    localSpeakingCleanupRef.current?.();
    streamRef.current?.getTracks().forEach((track) => track.stop());
    void audioContextRef.current?.close();
  }, [cleanupPeer]);

  return { muted, toggle, error, devices, selectedDeviceId, selectDevice, peerStates, speaking, diagnostics, debug, hasMicrophone };
}

export type VoiceChatController = ReturnType<typeof useVoiceChat>;
