import { Mic, MicOff } from "lucide-react";
import type { Participant, VoiceConnectionState } from "@/types/realtime";

const voiceLabels: Record<VoiceConnectionState, string> = { connecting: "голос подключается", connected: "голос подключён", reconnecting: "голос восстанавливается", failed: "ошибка голоса" };

export function Participants({ participants, hostId, currentParticipantId, voiceStates, speaking }: {
  participants: Participant[];
  hostId: string;
  currentParticipantId: string;
  voiceStates: Record<string, VoiceConnectionState>;
  speaking: Record<string, boolean>;
}) {
  return <section className="people-panel" aria-label="Участники комнаты">
    <div className="queue-heading"><h2>В КОМНАТЕ</h2><span data-testid="participant-count" className="participant-count">{participants.length}</span></div>
    <div className="participant-list">{participants.map((participant) => {
      const voiceState = participant.socketId ? voiceStates[participant.socketId] : undefined;
      const isSelf = participant.id === currentParticipantId;
      const isSpeaking = Boolean(participant.socketId && speaking[participant.socketId]);
      const voiceText = isSpeaking ? "говорит" : isSelf ? (participant.muted ? "микрофон выключен" : "микрофон включён") : voiceState ? voiceLabels[voiceState] : participant.muted ? "голос выключен" : "ожидание голоса";
      return <div key={participant.id} data-testid="participant" data-participant-id={participant.id} data-participant-name={participant.username} data-connected={participant.connected} data-is-host={participant.id === hostId} className="participant-row">
        <span className={`participant-avatar ${isSpeaking ? "is-speaking" : ""}`} aria-hidden="true">{participant.username.slice(0, 1).toUpperCase()}</span>
        <div className="participant-copy">
          <div className="participant-name-line"><span className="participant-name">{participant.username}</span>{participant.id === hostId && <span className="participant-host-label">HOST</span>}</div>
          <div className={`participant-status ${participant.connected ? "" : "is-reconnecting"}`}><i aria-hidden="true" />{participant.connected ? participant.ready ? "готов к просмотру" : "в комнате" : "переподключается"}</div>
          <div className="participant-voice">{voiceText}</div>
        </div>
        {participant.muted ? <MicOff className="participant-mic" aria-label="Микрофон выключен" /> : <Mic className="participant-mic" aria-label="Микрофон включён" />}
      </div>;
    })}</div>
  </section>;
}
