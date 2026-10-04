# Glossary — WatchTogether architecture review

| Term | Context | Meaning | Not to be confused with | Confirmed by |
|---|---|---|---|---|
| Room state | Server runtime | Participants, chat, permissions, and video state held by `RoomManager`. | Socket.IO room membership | Repository implementation |
| Process-local state | Deployment | Maps owned by one Node process; unavailable to another process and lost on restart. | Redis Socket.IO broadcast adapter | Repository implementation |
| Invite token | Room entry | Shareable `roomToken` carried by the invitation link and required to join. | `ownerToken`, `sessionToken`, or `streamToken` | `types/realtime.ts` |
| Session token | Reconnect | Secret that rebinds the same `participantId` during a participant session. | Invite token or current `socketId` | Repository implementation |
| Stream token | Host-stream HTTP | Per-connection bearer credential used to authorize the video byte stream. | Room invite token | Repository implementation |
| Voice mesh | WebRTC voice | A direct voice peer connection between each pair of connected participants. | Host-to-Guest P2P movie transfer | `hooks/use-voice-chat.ts` |
| Room capacity | Admission | Maximum admitted participant count chosen to protect the room's realtime and media resources. | A UI-only participant counter | Open owner decision |
| Offline shell | PWA | Cached static explanation shown when navigation cannot reach the server; it does not host an offline room. | Cached room state | `public/sw.js` |

## Forbidden synonyms

- `socketId` -> do not use as durable participant identity; use `participantId`.
- Socket.IO Redis adapter -> do not describe as shared room persistence; it only distributes Socket.IO events.
- Invite token -> do not call it an owner or session credential.
- P2P movie -> do not conflate its Host-to-Guest topology with voice mesh.
