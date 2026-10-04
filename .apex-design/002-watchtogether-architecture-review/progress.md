# Progress — WatchTogether architecture review

- Updated: 2026-10-04
- Current position: read-only review complete; recommendations pending owner direction

## Status board
- T-01 — pending — credential URL, referrer, and ingress-log mitigation.
- T-02 — pending — room-size and restart-survival targets require measurement and owner decision.
- T-03 — pending — depends on confirmed capacity target.
- T-04 — pending — voice WebRTC has no E2E coverage in the current suite.
- T-05 — pending — current worker-update E2E synthesizes `controllerchange`.
- T-06 — pending — Media Session metadata/playback state teardown is not cleared explicitly.
- T-07 — pending — operational counters/process-count policy are proposed.

## Decisions and blockers
- No code changed and no tests were run for this review.
- No architecture decision is marked accepted. Required open inputs: expected concurrent participants per room, concurrent room count, and whether active rooms must survive process restart.
- The design recommends retaining the single-process architecture until one of those requirements justifies a shared room store or media topology change.

## Owner handoff
- `RoomManager` and `HostStreamRegistry` are process-local; a Socket.IO adapter alone would not make rooms shared or durable.
- Voice peer connections form a mesh; the supported room ceiling should be measured and enforced server-side.
- Invite URLs intentionally carry a shareable room token; owner/session/stream credentials require stricter exposure and log controls.

## Session memory
- Reviewed `server.ts`, `server/room-manager.ts`, `server/socket-server.ts`, `types/realtime.ts`, voice/video hooks, PWA files, and relevant unit/E2E coverage.
- Existing E2E evidence includes 2-Guest P2P movie, reconnect, permissions, playback, PWA, and Media Session; no voice signaling E2E was found.
- No production environment was queried or changed.
