# WatchTogether architecture review

- Status: drafting
- Decision owner: requester
- Domain expert: requester for expected room size, recovery, and public-service goals
- Created: 2026-10-04

## Problem and outcome

Review the current WatchTogether architecture and identify the smallest improvements that reduce credential exposure, uncontrolled resource growth, and unverified realtime/browser behavior without replacing the current video or room design. The outcome is a prioritized, evidence-based improvement proposal; this review does not authorize implementation or production activation.

## Scope

- Room state ownership, reconnect/session credentials, and signaling boundaries.
- Host-stream, voice mesh, and P2P capacity assumptions.
- PWA cache/update behavior and Media Session lifecycle.
- E2E coverage and minimum operational evidence.

## Non-goals

- Rewriting the application as distributed services.
- Choosing a numeric room-size target without workload evidence and owner input.
- Changing production settings, restarting the service, or migrating live room state.

## Constraints

- Preserve the current Next.js + Socket.IO deployment shape until scale requirements justify a change.
- Keep room/video state authoritative on the server and retain `participantId`, `revision`, and server-side permission checks.
- No invite, owner, session, or stream credential may enter the PWA cache.

## Facts, assumptions, open questions

- Fact: `server.ts` constructs a `RoomManager` and `HostStreamRegistry`; both hold room/session/media state in process-local Maps.
- Fact: each voice participant creates peer connections for connected room peers; P2P movie uses a separate Host-to-Guest data-channel path.
- Fact: join accepts new participants without a server-side room capacity check; chat history is bounded to 100 messages.
- Fact: room invitations carry `roomToken` in the URL; host-stream playback puts `streamToken` in the video request query. Session and owner credentials are held in `sessionStorage`.
- Fact: the service worker uses a manually numbered cache and network-only navigation; E2E checks its behavior, but its update test dispatches a synthetic `controllerchange` event.
- Fact: E2E covers P2P movie with two Guests but has no voice signaling/media E2E scenario.
- Assumption: current priority is safe operation of relatively small rooms on one server process, not transparent process failover.
- Open question: what concurrent room count and maximum participants per room should the service support?
- Open question: must active rooms survive a process restart, or is the documented in-memory lifecycle acceptable?

## Decisions log

- No architecture decisions are accepted by this review. Scale, room-size, and restart-survival targets remain open.
