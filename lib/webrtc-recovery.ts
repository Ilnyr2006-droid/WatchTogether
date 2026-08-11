export type RecoveryAction = "wait" | "restart-ice" | "recreate" | "give-up";

export function recoveryAction(connectionState: RTCPeerConnectionState, attempts: number, recreations: number, maxAttempts = 3): RecoveryAction {
  if (connectionState === "disconnected") return "wait";
  if (connectionState !== "failed") return "wait";
  if (attempts < maxAttempts) return "restart-ice";
  if (recreations < 1) return "recreate";
  return "give-up";
}

export function reconcilePeerIds(currentPeerIds: Iterable<string>, participantIds: Iterable<string>, localSocketId?: string) {
  const active = new Set([...participantIds].filter((id) => id && id !== localSocketId));
  const current = new Set(currentPeerIds);
  return {
    remove: [...current].filter((id) => !active.has(id)),
    create: [...active].filter((id) => !current.has(id)),
    active,
  };
}
