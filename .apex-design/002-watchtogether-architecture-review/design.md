# Design — WatchTogether architecture review

## Decision digest

Keep the current single-process architecture for the present small-room scope and harden its credential, capacity, and lifecycle boundaries. Do not mistake the installed Redis adapter for shared room state. The main unresolved inputs are maximum room size and restart-survival expectations; those inputs would change the storage and media topology recommendation.

## Recommendation

Prefer targeted hardening in the existing Next.js + Socket.IO process. The current design already has useful boundaries: `RoomManager` is the authoritative mutation point, playback is revisioned, permissions are checked server-side, and video/PWA adapters reuse existing behavior. A distributed rewrite would add consistency and operations costs without a stated requirement.

Before widening public use, remove unnecessary credential exposure from URLs/logs and define/enforce a server-side room capacity based on a small load experiment. Add deterministic voice E2E and real service-worker update coverage. Clear Media Session metadata when leaving a player.

## Alternatives considered

| Option | Fit | Benefits | Costs and risks |
|---|---|---|---|
| Targeted hardening of current process-local design (recommended) | Small rooms; one active Node process; room loss on restart accepted | Minimal delivery risk; preserves existing room and video contracts | No restart recovery or horizontal scaling; capacity must remain bounded |
| Shared room store plus multi-process Socket.IO | Required only if process failover or multiple app instances become a goal | Can coordinate room mutations and allow horizontal deployment | Requires atomic revision/permission/session operations, shared TTL/grace timers, shared rate limits, and a decision for host media files; Redis pub/sub alone is insufficient |
| SFU/server-mediated media | Consider only if measured mesh/upload limits block the target room size | Reduces voice peer count and client upload fanout | Adds media service, credentials, deployment, monitoring, and failure domains; current evidence does not justify it |

## Contracts and data

- Preserve the existing `participantId`/`socketId` split, server-assigned `VideoState.revision`, and server-side `canControlPlayback` checks.
- Keep `roomToken` as an intentionally shareable invite capability, but remove it from the active address after successful join and prevent query strings from being logged or forwarded as referrers where deployment permits.
- Treat `ownerToken`, `sessionToken`, and `streamToken` as secrets with separate scope and revocation. The native `<video>` stream URL currently carries `streamToken` in a query, so ingress logging needs explicit redaction or the stream authorization contract should move to a scoped HttpOnly cookie/URL exchange.
- A future multi-process design must atomically mutate room state and revision and coordinate Host role changes, session takeover, grace expiry, and token invalidation. A Socket.IO adapter does not provide those semantics.
- Define `ROOM_FULL` only after the room-size target is confirmed and measured against voice mesh, chat/state snapshots, and P2P Host uplink.

## Failure, security, and privacy

- `RoomManager` and `HostStreamRegistry` are process-local. Restart loses rooms; a second process sees a different room map. Do not claim failover or horizontal scaling.
- `roomToken` and `streamToken` appear in URL query parameters. `Cache-Control: private, no-store` protects the host-stream response from HTTP caching, but it does not by itself redact reverse-proxy logs.
- The service worker has a positive path allowlist and keeps navigation network-only. Make the asset paths and cache version harder to misconfigure as future dynamic routes are added.
- Voice is a full mesh. Without a measured server-side admission cap, one invite can increase peer, CPU, bandwidth, and snapshot work without a bound.
- Diagnostics must use room/participant counts and error codes, never token values, invite URLs, raw media URLs, or SDP/candidate contents.

## Operations

- Near term: document one authoritative process per room and restart behavior; measure a representative voice/P2P room before choosing admission limits.
- Add low-cardinality counters for active rooms/participants, disconnect expiry, media transfer failure, and WebRTC connection outcomes.
- Verify effective `Referrer-Policy` and access-log query redaction at the actual ingress; repository configuration alone cannot prove proxy behavior.
- No production change or migration is part of this review. Rollback for later code hardening is a code revert; shared-state migration would require a separate expand/migrate/contract decision.

## Risks and revisit conditions

- Revisit the single-process recommendation if the deployment needs more than one application process, active rooms to survive restart, or measured room loss is unacceptable.
- Revisit mesh only after a load run records peer connection time, CPU, host upload, and reconnect success across the intended number of participants.
- Current Playwright P2P coverage is not evidence for voice signaling; a movie DataChannel is a separate protocol.
- The service-worker update E2E synthesizes `controllerchange`; it does not yet prove a browser installing and activating a newer worker version.
- The review assumes small ephemeral rooms because no target concurrency or persistence objective was supplied.
