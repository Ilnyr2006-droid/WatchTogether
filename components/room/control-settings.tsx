"use client";

import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, RoomControlMode, RoomState, ServerToClientEvents } from "@/types/realtime";

const labels: Record<RoomControlMode, string> = {
  everyone: "Все могут управлять",
  "host-only": "Только Host",
  approved: "По разрешению Host",
};

export function ControlSettings({ socket, room, participantId, isHost, canControl }: {
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  room: RoomState;
  participantId: string;
  isHost: boolean;
  canControl: boolean;
}) {
  const pending = room.controlRequests.includes(participantId);
  return <section className="panel p-4" data-testid="control-settings">
    <h2 className="font-semibold">Управление комнатой</h2>
    {isHost ? <>
      <label className="mt-3 block text-xs text-slate-400" htmlFor="control-mode">Кто управляет видео</label>
      <select id="control-mode" className="input mt-1 py-2" value={room.controlMode} onChange={(event) => socket.emit("room:control-mode", { mode: event.target.value as RoomControlMode })}>
        {(Object.keys(labels) as RoomControlMode[]).map((mode) => <option key={mode} value={mode}>{labels[mode]}</option>)}
      </select>
      {room.controlMode === "approved" && <div className="mt-3 space-y-2">
        {room.controlRequests.length === 0 && <p className="text-xs text-slate-500">Запросов пока нет</p>}
        {room.controlRequests.map((id) => {
          const participant = room.participants.find((person) => person.id === id);
          if (!participant) return null;
          return <div key={id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
            <span>{participant.username} просит управление</span>
            <span className="flex gap-2">
              <button className="text-emerald-300 hover:text-emerald-200" onClick={() => socket.emit("room:control-approve", { participantId: id })}>Разрешить</button>
              <button className="text-slate-400 hover:text-white" onClick={() => socket.emit("room:control-reject", { participantId: id })}>Отклонить</button>
            </span>
          </div>;
        })}
        {room.approvedControllerIds.map((id) => {
          const participant = room.participants.find((person) => person.id === id);
          if (!participant) return null;
          return <div key={id} className="flex items-center justify-between gap-2 rounded-lg bg-white/[0.04] px-3 py-2 text-sm">
            <span>{participant.username}: управление разрешено</span>
            <button className="text-amber-300 hover:text-amber-200" onClick={() => socket.emit("room:control-revoke", { participantId: id })}>Отозвать</button>
          </div>;
        })}
      </div>}
    </> : <>
      <p className="mt-2 text-sm text-slate-400">{labels[room.controlMode]}</p>
      {room.controlMode === "approved" && <button className="button-secondary mt-3 py-2 text-sm" disabled={pending || canControl} onClick={() => socket.emit("room:control-request")}>
        {canControl ? "Управление разрешено" : pending ? "Запрос отправлен" : "Запросить управление"}
      </button>}
      {room.controlMode === "host-only" && <p className="mt-2 text-xs text-slate-500">Видео и файл Host выбирает только Host.</p>}
    </>}
  </section>;
}
