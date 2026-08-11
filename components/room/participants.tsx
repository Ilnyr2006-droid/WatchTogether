import { Crown, Mic, MicOff, Radio } from "lucide-react";
import type { Participant, VoiceConnectionState } from "@/types/realtime";

const voiceLabels: Record<VoiceConnectionState, string> = { connecting: "голос подключается", connected: "голос подключён", reconnecting: "голос восстанавливается", failed: "ошибка голоса" };
const voiceColors: Record<VoiceConnectionState, string> = { connecting: "text-amber-300", connected: "text-emerald-400", reconnecting: "text-amber-300", failed: "text-red-300" };

export function Participants({ participants, hostId, currentSocketId, voiceStates, speaking }: {
  participants: Participant[];
  hostId: string;
  currentSocketId?: string;
  voiceStates: Record<string, VoiceConnectionState>;
  speaking: Record<string, boolean>;
}) {
  return <section className="panel p-4"><div className="mb-3 flex items-center justify-between"><h2 className="font-semibold">Участники</h2><span className="rounded-full bg-white/5 px-2 py-1 text-xs text-slate-400">{participants.length}/4</span></div><div className="space-y-2">{participants.map((participant) => {
    const voiceState = voiceStates[participant.socketId];
    const isSelf = participant.socketId === currentSocketId;
    const voiceText = isSelf ? (participant.muted ? "микрофон выключен" : "микрофон включён") : voiceState ? voiceLabels[voiceState] : participant.muted ? "голос выключен" : "ожидание голоса";
    const voiceColor = isSelf ? (participant.muted ? "text-slate-500" : "text-emerald-400") : voiceState ? voiceColors[voiceState] : "text-slate-500";
    return <div key={participant.socketId} className="flex items-center gap-3 rounded-xl bg-white/[0.03] p-3"><span className={`grid size-9 shrink-0 place-items-center rounded-full bg-gradient-to-br from-violet-500 to-fuchsia-700 font-bold transition ${speaking[participant.socketId] ? "ring-2 ring-emerald-400 ring-offset-2 ring-offset-[#111620]" : ""}`}>{participant.username.slice(0, 1).toUpperCase()}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-1.5"><span className="truncate text-sm font-medium">{participant.username}</span>{participant.socketId === hostId && <Crown className="size-3.5 text-amber-400" />}</div><div className="mt-0.5 flex items-center gap-1 text-xs text-emerald-400"><Radio className="size-3" />в сети{participant.ready && " · видео готово"}</div><div className={`mt-0.5 text-[11px] ${voiceColor}`}>{speaking[participant.socketId] ? "говорит" : voiceText}</div></div>{participant.muted ? <MicOff className="size-4 text-slate-500" /> : <Mic className="size-4 text-emerald-400" />}</div>;
  })}</div></section>;
}
