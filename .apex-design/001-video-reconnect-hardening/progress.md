# Progress — Video timing, playback intent, and reconnect edge cases

- Updated: 2026-10-04
- Current position: implementation and validation complete

## Status board
- T-01 — done — original owner recovers Host after grace expiry or explicit leave; approved grants persist across mode changes.
- T-02 — done — snapshots pair effective playhead with the same returned `updatedAt` without mutating canonical room state or revision.
- T-03 — done — local play/pause intent updates immediately; matching remote media events are suppressed by desired state.
- T-04 — done — guest guidance reflects Everyone, Host only, and an approved grant.
- T-05 — done — late join during playback and reconnect/owner recovery lifecycle covered with identity/count assertions.
- T-06 — done — two-guest P2P transfer recovers after an ordinary Socket.IO reconnect with stable identity and increasing received bytes.
- T-07 — done — all requested checks passed: 74 unit tests and 7 offline E2E tests, typecheck, lint, and production build.
- T-08 — done — HTML5/P2P and RUTUBE force-resync only on control loss; the delayed-play/revoke E2E verifies `FORBIDDEN`, unchanged revision, paused media and restored playhead; takeover tests verify stream-token invalidation and active-transfer closure.

## Decisions and blockers
- Requester confirmed the decision digest and glossary and authorized implementation on 2026-10-04.
- D-01 — resolved 2026-10-04: original owner can restore Host with `ownerToken` after grace expiry or explicit leave.
- D-02 — resolved 2026-10-04: approved grants persist across mode changes; pending requests clear when Ask control is disabled.

## Owner handoff
- `revision` orders authoritative video mutations; `updatedAt` anchors elapsed play time. A snapshot must rebase both returned fields together without mutating canonical state.
- `participantId` owns durable permissions; `socketId` only routes current signaling.
- Original owner and current Host are distinct concepts whenever Host transfers.

## Session memory
- Current branch is `p0-participant-reconnect-control`; code checkout was clean before the planning workspace was created.
- Existing local E2E server uses port 4173 and `WATCHTOGETHER_E2E=true`; fixture media and loopback STUN are already present.
- Implementation is complete on the planned branch; validation used the local E2E fixture, isolated test port, and loopback-only ICE configuration.
- Final validation for T-08 passed: 76 unit tests, typecheck, lint, build, and 8 offline Playwright E2E tests.
- No production deployment or restart was performed.
