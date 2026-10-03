# Design — Video timing, playback intent, and reconnect edge cases

## Decision digest

Confirmed: original-owner `ownerToken` can restore Host after grace expiry or explicit leave; approved grants persist across mode switches, while pending requests are cleared when Ask control is disabled. Correct snapshot time by rebasing returned `updatedAt` to the same `now`, without mutating room state or revision; update local playback intent immediately after emit; make permission copy reflect the actual mode/grant; extend offline E2E through video events, lifecycle transitions, and P2P reconnect. Main tradeoff: owner recovery can reverse an automatic Host transfer.

## Recommendation

Use targeted fixes in the existing `RoomManager`, shared video-sync hook, room UI, and Playwright suites. Keep all state server-authoritative and all E2E networking local. Do not introduce a second room/identity mechanism.

For snapshots, capture one `now` value and return `currentTime: effectiveVideoTime(room.video, now)` and `updatedAt: now`; leave the stored `room.video` and `revision` untouched. This makes the returned playhead the base for its returned timestamp.

For local playback events, keep the remote-application guard. If a local play/pause action passes the guard and is emitted, immediately update `desiredPlaying.current` to the requested state. Applying a newer server state remains the only operation that reconciles intent to the canonical room state.

For room guidance, derive the guest message from `controlMode` and `approvedControllerIds`; retain the current Host-facing message. Cover Everyone, unapproved Ask control, approved Ask control, and Host only in UI tests.

## Alternatives considered

| Option | Outcome and quality | Risk and reversibility | Delivery/operations |
|---|---|---|---|
| Targeted fixes in current design (recommended) | Addresses the identified time, intent, UI, and missing-E2E gaps while preserving Socket.IO authority and current room model. | Low change surface; easy to revert. Owner/grant semantics still require D-01/D-02. | Reuses current types, test fixtures, and E2E mode; no migration or new service. |
| Persist room/session state in a new database and redesign role recovery | Could survive process restarts and provide durable ownership history. | Much larger schema, migration, and consistency risk; not needed to fix the observed defects. | New operations, backup, retention, and deployment responsibilities. Out of scope. |
| Add only unit tests or direct socket-event E2E | Cheap and deterministic for isolated logic. | Would miss browser media event behavior, late join snapshot projection, and actual P2P reconnect wiring. | Small initial effort but weaker regression evidence. |

## Contracts and data

- No Socket.IO payload or `VideoState` schema changes are required.
- Snapshot is a read projection. For a playing state, the returned playhead and `updatedAt` share one server-time anchor; revision remains the stored authoritative revision.
- The `video:action` input order received by the server remains the source of revision order. A local video event must not be discarded only because the last server-applied desired state is stale.
- Approved rights stay keyed by `participantId`; current connection routing continues to use `socketId`.
- D-01: a valid room `ownerToken` may restore original-owner Host status after participant removal. The invite URL never carries this secret.
- D-02: `approvedControllerIds` survive mode changes; pending requests clear when leaving Ask control.

## Failure, security, and privacy

- Preserve revision filtering and `applyingRemote` suppression to reject stale states and prevent feedback loops.
- Do not mutate canonical room video state while producing snapshots; this avoids hidden mutations with unchanged revision.
- Retain Zod validation, room-token checks, current server-side permissions, and E2E-only network behavior.
- Test credentials only through the existing browser session storage flow; never log tokens or include them in assertions/output.
- P2P reconnect tests use the configured loopback STUN and local MP4; external hosts remain blocked by the E2E fixture.

## Operations

- No production data migration or new environment setting is expected.
- Verification runs locally against the isolated Playwright port and test fixture.
- Do not activate or restart production under this plan. If a later request asks for deployment, prepare and verify first; room state is in memory and a service restart ends active rooms.
- Rollback is a code revert; there is no persistent schema to roll back.

## Risks and revisit conditions

- D-01 means a Guest promoted after 30 seconds can later lose Host when the original owner returns; the owner recovery credential remains private and is covered by tests.
- D-02 means a prior grant becomes active again when Ask control is re-enabled; UI must accurately reflect the retained grant.
- Snapshot projection assumes the server wall clock is the shared timestamp basis already used by `updatedAt`; changing clock strategy is outside this scope.
- P2P socket reconnect may expose an existing peer recreation defect. Fix only the observed signaling/cleanup path and preserve current transport and media protocol.
- Reopen the design if video state becomes persisted/shared across server processes, or if owner/grant behavior changes beyond these room semantics.
