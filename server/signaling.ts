import type { RoomManager } from "./room-manager";

export function canRelaySignal(rooms: RoomManager, senderId: string, targetId: string) {
  if (!senderId || !targetId || senderId === targetId) return false;
  const senderRoom = rooms.getBySocket(senderId);
  const targetRoom = rooms.getBySocket(targetId);
  return Boolean(senderRoom && targetRoom && senderRoom.id === targetRoom.id && rooms.hasParticipant(senderRoom, senderId) && rooms.hasParticipant(senderRoom, targetId));
}
