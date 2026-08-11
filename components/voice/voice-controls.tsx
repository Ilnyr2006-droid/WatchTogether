"use client";

import { Activity, Mic, MicOff } from "lucide-react";
import type { VoiceChatController } from "@/hooks/use-voice-chat";

export function VoiceControls({ voice }: { voice: VoiceChatController }) {
  return <div className="flex flex-col items-end gap-2">
    <div className="flex flex-wrap justify-end gap-2">
      {voice.devices.length > 1 && <label className="sr-only" htmlFor="microphone-select">Микрофон</label>}
      {voice.devices.length > 1 && <select id="microphone-select" className="rounded-xl border border-white/10 bg-[#111620] px-3 py-2 text-sm text-slate-200" value={voice.selectedDeviceId} onChange={(event) => { void voice.selectDevice(event.target.value); }}>
        {voice.devices.map((device, index) => <option key={device.deviceId} value={device.deviceId}>{device.label || `Микрофон ${index + 1}`}</option>)}
      </select>}
      <button className={voice.muted ? "button-primary" : "button-secondary"} onClick={voice.toggle}>{voice.muted ? <MicOff className="size-5" /> : <Mic className="size-5 text-emerald-400" />}{voice.muted ? "Включить микрофон" : "Выключить микрофон"}</button>
    </div>
    {voice.debug && Object.keys(voice.diagnostics).length > 0 && <details className="w-full max-w-xl rounded-xl border border-white/10 bg-black/20 p-3 text-xs text-slate-400">
      <summary className="flex cursor-pointer items-center gap-2 font-medium text-slate-300"><Activity className="size-4" />WebRTC diagnostics</summary>
      <div className="mt-2 space-y-2">{Object.entries(voice.diagnostics).map(([peerId, stats]) => <div key={peerId} className="grid grid-cols-2 gap-x-3 rounded-lg bg-white/[0.03] p-2 sm:grid-cols-4"><span>{stats.state}</span><span>{stats.transport} · {stats.candidateType ?? "—"}</span><span>RTT {stats.rttMs ?? "—"} ms</span><span>jitter {stats.jitterMs ?? "—"} ms · loss {stats.packetsLost ?? "—"}</span></div>)}</div>
    </details>}
  </div>;
}
