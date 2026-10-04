# Requirements

## Functional

- Only the original Owner may browse/register a backend file; current Host privileges do not imply Owner.
- Local media is registered from a canonical regular file, with metadata obtained server-side and an unpredictable room-bound ID.
- Every room participant with a valid stream token may GET/HEAD the active media and use byte ranges; streaming uses bounded Node file streams.
- Playlist stores only public-safe remote/local metadata, supports add, Host-only play/remove/reorder/clear, and server-validated automatic next.
- Duplicate ended events must not advance more than once. Missing/changed local files produce a safe Owner/Host-facing error without exposing paths.
- Readiness reflects local media load; browser codec errors are reported without conversion.
- Two user-facing source choices only. Existing P2P player/signaling remains intact but transport selection is hidden.

## Security and lifecycle

- Validate all new Socket.IO payloads with Zod and repeat permissions in server handlers/RoomManager.
- Never serialize absolute paths into RoomState, Socket.IO, or endpoint responses.
- Bind IDs to room, authorize each stream request, reject invalid ranges, and send no-store headers.
- Close active local-media responses on socket disconnect/session takeover; clear room registry when the room is destroyed.
- Playlist and registry remain process-local; restart recovery/database are out of scope.

## Verification

- Unit/integration coverage for Owner-vs-Host, path secrecy, room binding, Range/HEAD/416, byte identity, queue permissions/order, automatic-next idempotence, unavailable files, revision, and stream cleanup.
- Local Playwright coverage for Owner plus two Guests, queue/source sharing, playback and readiness, next item, late join, and reconnect.
