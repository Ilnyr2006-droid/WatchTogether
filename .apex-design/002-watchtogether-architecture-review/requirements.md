# Requirements — WatchTogether architecture review

These are proposed acceptance scenarios, not approved delivery commitments. The room-size and restart targets must be confirmed before tasks that depend on them are planned.

- R-01 — Invite, owner, session, and stream credentials are absent from cache entries and are not retained in access logs or referrer data beyond the intentional shareable invite transport (serves: reduce room takeover and stream disclosure risk).
- R-02 — The supported deployment mode is explicit: either one authoritative Node process per live room, or all room mutations, credentials, reconnect timers, and broadcasts have tested shared semantics across processes (serves: prevent split-brain rooms).
- R-03 — A measured participant ceiling is enforced server-side; an excess join receives a stable `ROOM_FULL` result and does not alter room state (serves: bound memory, signaling, and media load).
- R-04 — A local E2E scenario proves voice offer/answer/candidate signaling, successful peer connection, and peer cleanup on leave/reconnect without external STUN/TURN or a physical microphone (serves: protect voice as a core feature).
- R-05 — A real service-worker version transition activates the new worker, removes obsolete caches, and reloads a controlled client once; a cache audit proves every entry is in the approved static allowlist (serves: avoid stale clients and private-data caching).
- R-06 — Leaving the room clears the OS/browser media-session metadata and playback state as well as unregistering action handlers (serves: avoid stale controls after navigation).
- R-07 — Runtime diagnostics report room/member counts, disconnect expiry, stream failures, and WebRTC outcomes without recording credentials, invite URLs, or media URLs (serves: shorten incident diagnosis without increasing secret exposure).

## Failure and abuse scenarios

- R-08 — A leaked request URL, reverse-proxy log, or referrer must not grant durable Host/session access or expose an indefinitely reusable media stream credential.
- R-09 — A popular or shared invite cannot grow a room's in-memory participants and WebRTC peers without a server-side limit.
- R-10 — A restart or second application process must not be represented as transparent room recovery unless state and signaling recovery have been verified end-to-end.
