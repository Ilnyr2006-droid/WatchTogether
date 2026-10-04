# Glossary — Video timing, playback intent, and reconnect edge cases

| Term | Context | Meaning | Not to be confused with | Confirmed by |
|---|---|---|---|---|
| Participant | Room model | A stable room member identified by `participantId`; can reconnect with a `sessionToken`. | Socket.IO connection | Repository types and tests |
| `participantId` | Identity | Stable identity for one participant across reconnects. | `socketId` | Repository types and tests |
| `sessionToken` | Reconnect authentication | Credential that rebinds the same participant while that participant session exists. | Room invitation or owner recovery credential | Repository implementation |
| `socketId` | Transport | Current Socket.IO connection identifier used to route live signals. | Stable participant identity | Repository implementation |
| Host | Room authorization | The participant currently holding the Host role and its Host-only capabilities. | Original room creator / owner | `RoomState.hostId` |
| Original owner | Room recovery | Participant recorded at room creation; by D-01, the room's `ownerToken` can restore this participant as Host after grace expiry or explicit leave. | Current Host after a role transfer | D-01 |
| `ownerToken` | Room recovery credential | Secret credential used to restore the original owner identity/Host role after its participant session is removed. | Guest invite URL or `sessionToken` | D-01 |
| Grace period | Disconnect lifecycle | 30 seconds in which a disconnected participant can reconnect before removal and Host transfer. | Explicit `room:leave`, which removes immediately | Socket server configuration |
| Approved grant | Playback permission | A participant's permission recorded by `participantId` in `approvedControllerIds`; by D-02, it survives switching control modes. | Pending control request | D-02 |
| Video revision | Playback ordering | Server-incremented integer that orders authoritative video mutations. | Wall-clock timestamp | `VideoState.revision` |
| `updatedAt` | Playback timing | Time anchor for calculating elapsed playback from `currentTime`. | Ordering/version number | `VideoState.updatedAt` |
| Snapshot | State delivery | A copy of room state sent to clients, including an effective video playhead. | Mutation of the stored room state | `RoomManager.snapshot()` |

## Forbidden synonyms

- `socketId` -> do not use for participant identity or durable permissions; use `participantId`.
- `ownerToken` -> do not call a room invite or session token.
- Original owner -> do not assume this is the current Host after transfer.
- PWA static cache -> explicitly allowlisted same-origin assets and the offline shell; never room/session payloads, API data, invite URLs, or media streams.
- Offline shell -> token-free static page explaining that the server and a network connection are required; it does not create an offline room.
- Picture-in-Picture -> browser-controlled floating window for an HTML5 video element, available only when both document and element APIs report support.
- Media Session -> operating-system/browser media controls whose playback actions pass through the same `canControl`-guarded player handlers as local controls.
