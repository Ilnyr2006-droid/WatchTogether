"use client";

import { ListVideo, MessageCircle, Users, X } from "lucide-react";
import type { Socket } from "socket.io-client";
import type { ClientToServerEvents, RoomState, ServerToClientEvents } from "@/types/realtime";
import type { VoiceChatController } from "@/hooks/use-voice-chat";
import { ChatPanel } from "@/components/chat/chat-panel";
import { ControlSettings } from "@/components/room/control-settings";
import { Participants } from "@/components/room/participants";
import { VoiceControls } from "@/components/voice/voice-controls";

export type RoomDrawerTab = "queue" | "chat" | "people";

const tabLabels: Record<RoomDrawerTab, string> = { queue: "Очередь", chat: "Чат", people: "Люди" };
const tabIcons = { queue: ListVideo, chat: MessageCircle, people: Users };

export function RoomTabs({ activeTab, onSelect }: { activeTab: RoomDrawerTab | null; onSelect: (tab: RoomDrawerTab) => void }) {
  return <nav className="room-tab-nav" role="tablist" aria-label="Панель комнаты">
    {(Object.keys(tabLabels) as RoomDrawerTab[]).map((tab) => {
      const Icon = tabIcons[tab];
      return <button key={tab} type="button" role="tab" aria-selected={activeTab === tab} aria-controls={`room-pane-${tab}`} className="room-tab" onClick={() => onSelect(tab)}>
        <Icon aria-hidden="true" /><span>{tabLabels[tab]}</span>
      </button>;
    })}
  </nav>;
}

export function RoomDrawer({ activeTab, onClose, room, participantId, isHost, canControl, socket, voice, queueSlotRef }: {
  activeTab: RoomDrawerTab | null;
  onClose: () => void;
  room: RoomState;
  participantId: string;
  isHost: boolean;
  canControl: boolean;
  socket: Socket<ServerToClientEvents, ClientToServerEvents>;
  voice: VoiceChatController;
  queueSlotRef: (node: HTMLDivElement | null) => void;
}) {
  const title = activeTab ? tabLabels[activeTab] : "Панель комнаты";
  return <aside className="room-drawer" aria-label={title} hidden={!activeTab}>
    <div className="room-drawer-head"><h2>{title}</h2><button type="button" className="room-drawer-close" aria-label="Закрыть панель" onClick={onClose}><X aria-hidden="true" /></button></div>
    <section id="room-pane-queue" className="drawer-pane" role="tabpanel" aria-label="Очередь" hidden={activeTab !== "queue"}>
      <div id="watchtogether-queue-slot" ref={queueSlotRef} />
    </section>
    <section id="room-pane-chat" className="drawer-pane" role="tabpanel" aria-label="Чат" hidden={activeTab !== "chat"}>
      <ChatPanel socket={socket} initialMessages={room.messages} />
    </section>
    <section id="room-pane-people" className="drawer-pane" role="tabpanel" aria-label="Участники" hidden={activeTab !== "people"}>
      <Participants participants={room.participants} hostId={room.hostId} currentParticipantId={participantId} voiceStates={voice.peerStates} speaking={voice.speaking} />
      <div className="voice-controls"><VoiceControls voice={voice} /></div>
      <ControlSettings socket={socket} room={room} participantId={participantId} isHost={isHost} canControl={canControl} />
    </section>
  </aside>;
}
