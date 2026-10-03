# Video timing, playback intent, and reconnect edge cases

- Status: planned
- Decision owner: requester
- Domain expert: requester (room ownership and playback expectations)
- Created: 2026-10-03

## Problem and outcome

Several edge cases remain after the participant/revision/permissions and multi-context E2E work: snapshots can double-advance video time, rapid local play/pause events can be suppressed using stale intent, the room-level playback message can contradict actual permissions, and tests do not yet exercise late join during playback or socket-only P2P recovery. The outcome is consistent authoritative playback, truthful permission messaging, explicit owner-transfer behavior, and regression coverage for those cases.

## Scope

- Normalize `VideoState.currentTime` and `updatedAt` together in room snapshots without changing the stored state or incrementing `revision`.
- Update the local desired play/pause intent immediately after emitting a local action while preserving remote-application loop prevention.
- Show room guidance that reflects Everyone, Host only, and the participant's approved status.
- Implement the selected `ownerToken` recovery policy after grace-period expiry or explicit leave (D-01).
- Preserve approved playback grants across mode changes and clear pending requests when Ask control is disabled (D-02).
- Extend offline Playwright coverage for late join during playback, fast Play → Pause → Play through the HTML video element, grace expiry/Host transfer, explicit leave, expired credentials, and P2P socket reconnect without reload.

## Non-goals

- Replace the current in-memory room model, identity/session design, Socket.IO architecture, or WebRTC signaling model.
- Add a database, new production service, public-network dependency, TURN service, or new package.
- Change unrelated RUTUBE, chat, voice, room-token, or P2P transfer behavior unless a new regression is demonstrated by the scoped verification.
- Deploy to production or restart the live service as part of this design.

## Constraints

- Preserve stable `participantId`, `sessionToken`, `socketId` connection binding, 30-second grace period, authoritative `VideoState.revision`, server-side permissions, and `WATCHTOGETHER_E2E=true` isolation.
- Tests use separate BrowserContexts, local fixtures/STUN, and no external network.
- Keep the existing architecture and avoid cosmetic refactors.
- A 30-second lifecycle E2E may wait on observable state with Playwright polling; do not replace the production grace duration with a hidden test shortcut.

## Facts and assumptions

- Decision confirmation: requester approved the decision digest and glossary on 2026-10-03.

- Fact: `RoomManager.snapshot()` computes effective `currentTime` but returns the old `updatedAt`, so the receiver can count elapsed playback twice.
- Fact: `useVideoSync` changes `desiredPlaying` when authoritative state is applied, not when a local play/pause action is emitted.
- Fact: `RoomManager.setControlMode()` currently clears both pending requests and approved IDs when switching away from `approved`.
- Fact: after 30 seconds, `socket-server.ts` removes the disconnected participant and transfers Host; the room-level `ownerToken` can still restore the original owner as Host.
- Fact: the existing playback E2E emits Socket.IO actions directly; existing P2P E2E tests initial multi-guest transfer, not a socket-only reconnect.
- Fact: current UI shows “Просмотром управляет Host” to every guest, including Everyone and approved participants.
- Fact: per D-01, the original owner may recover Host through `ownerToken` after grace expiry or explicit leave.
- Fact: per D-02, approved grants persist across mode changes and pending requests clear when Ask control is disabled.

## Decisions log

- D-01 — Should the original owner’s `ownerToken` restore Host after grace expiry or explicit leave? -> yes; the original owner may reclaim Host, so automatic Host transfer is reversible (answered 2026-10-03).
- D-02 — Should `approvedControllerIds` survive switching away from and back to Ask control? -> yes; retain grants by `participantId`, while clearing pending requests when Ask control is disabled (answered 2026-10-03).
