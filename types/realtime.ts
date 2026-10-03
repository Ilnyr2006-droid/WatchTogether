export type VideoProvider = "html5" | "rutube";

export type VideoSource =
  | { provider: "html5"; mode: "url"; url: string }
  | { provider: "html5"; mode: "local"; fileName: string }
  | {
      provider: "html5";
      mode: "host-stream";
      fileName: string;
      streamId: string;
    }
  | {
      provider: "html5";
      mode: "p2p-movie";
      fileName: string;
      size: number;
      duration: number;
      mimeCodec: string;
      codecs: string[];
      width: number | null;
      height: number | null;
      sourceId: string;
    }
  | {
      provider: "rutube";
      videoId: string;
      accessKey: string | null;
      originalUrl: string;
    };

export interface Participant {
  socketId: string;
  username: string;
  muted: boolean;
  ready: boolean;
  joinedAt: number;
  connected: boolean;
}

export interface VideoState {
  source: VideoSource | null;
  currentTime: number;
  playing: boolean;
  updatedAt: number;
}

export interface RoomState {
  id: string;
  hostId: string;
  participants: Participant[];
  video: VideoState;
  messages: ChatMessage[];
}

export interface ChatMessage {
  id: string;
  username: string;
  text: string;
  timestamp: number;
}

export type VideoAction = "play" | "pause" | "seek" | "sync";
export type VoiceConnectionState =
  "connecting" | "connected" | "reconnecting" | "failed";

export interface VoiceDiagnostic {
  state: RTCPeerConnectionState;
  rttMs: number | null;
  jitterMs: number | null;
  packetsLost: number | null;
  candidateType: string | null;
  transport: "TURN" | "P2P";
}

export interface ServerToClientEvents {
  "room:state": (state: RoomState) => void;
  "room:error": (error: { message: string; code: string }) => void;
  "participant:joined": (participant: Participant) => void;
  "participant:left": (payload: {
    socketId: string;
    hostId: string | null;
  }) => void;
  "participant:update": (participant: Participant) => void;
  "video:state": (video: VideoState) => void;
  "chat:message": (message: ChatMessage) => void;
  "webrtc:offer": (payload: SignalDescription) => void;
  "webrtc:answer": (payload: SignalDescription) => void;
  "webrtc:ice-candidate": (payload: SignalCandidate) => void;
  "movie:offer": (payload: SignalDescription) => void;
  "movie:answer": (payload: SignalDescription) => void;
  "movie:ice-candidate": (payload: SignalCandidate) => void;
}

export interface SignalDescription {
  from: string;
  to: string;
  description: RTCSessionDescriptionInit;
}

export interface SignalCandidate {
  from: string;
  to: string;
  candidate: RTCIceCandidateInit;
}

type Ack<T = undefined> = (
  response: { ok: true; data: T } | { ok: false; error: string },
) => void;

export interface ClientToServerEvents {
  "room:create": (
    payload: { username: string },
    ack: Ack<{ roomId: string; roomToken: string; ownerToken: string }>,
  ) => void;
  "room:join": (
    payload: { roomId: string; username: string; roomToken: string; ownerToken?: string },
    ack: Ack<{ room: RoomState; streamToken: string }>,
  ) => void;
  "room:leave": () => void;
  "participant:update": (payload: { muted?: boolean; ready?: boolean }) => void;
  "video:set-source": (
    payload:
      | { input: string }
      | { localFileName: string }
      | { p2pMovie: P2PMovieSourceInput },
  ) => void;
  "video:action": (payload: {
    action: VideoAction;
    currentTime: number;
  }) => void;
  "chat:send": (payload: { text: string }, ack: Ack) => void;
  "webrtc:offer": (payload: Omit<SignalDescription, "from">) => void;
  "webrtc:answer": (payload: Omit<SignalDescription, "from">) => void;
  "webrtc:ice-candidate": (payload: Omit<SignalCandidate, "from">) => void;
  "movie:offer": (payload: Omit<SignalDescription, "from">) => void;
  "movie:answer": (payload: Omit<SignalDescription, "from">) => void;
  "movie:ice-candidate": (payload: Omit<SignalCandidate, "from">) => void;
}

export interface P2PMovieSourceInput {
  fileName: string;
  size: number;
  duration: number;
  mimeCodec: string;
  codecs: string[];
  width: number | null;
  height: number | null;
  sourceId: string;
}

export type InterServerEvents = Record<never, never>;
export interface SocketData {
  roomId?: string;
  username?: string;
}
