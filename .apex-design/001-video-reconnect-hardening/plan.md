# Plan — Video timing, playback intent, and reconnect edge cases

- T-01 — Resolve and enforce room ownership and grant semantics
  - files: `server/room-manager.ts`, `tests/room-manager.test.ts`, `tests/e2e/room.spec.ts`, `tests/e2e/permissions.spec.ts`
  - action: implement D-01 owner-token behavior and D-02 approved-grant persistence; distinguish durable approved grants from pending requests; test host recovery/transfer and mode changes by participant identity.
  - verify: focused RoomManager and permission/lifecycle E2E assertions for each selected branch.
  - done: original owner and promoted Host behavior is unambiguous after disconnect expiry and explicit leave; mode toggles match D-02; no duplicate participant is created.
  - satisfies: D-01, D-02, R-04, R-05, R-08, R-13

- T-02 — Rebase video snapshot time
  - files: `server/room-manager.ts`, `tests/room-manager.test.ts`, `tests/video-sync.test.ts`
  - action: compute one snapshot timestamp and pair effective `currentTime` with that returned `updatedAt`, without changing canonical room state or revision.
  - verify: fake-clock unit test snapshots a playing video after elapsed time and confirms effective time is not counted twice; revision and stored state remain unchanged.
  - done: late-join/reload state starts from the correct playhead and keeps its existing revision.
  - satisfies: R-01, R-06, R-11

- T-03 — Keep local playback intent current
  - files: `hooks/use-video-sync.ts`, `lib/video-sync.ts`, `tests/video-sync.test.ts`, `tests/e2e/playback.spec.ts`
  - action: update local desired-playing state immediately after an emitted play/pause action; preserve remote-state suppression and add rapid HTML video-element event coverage.
  - verify: unit test exercises play/pause/play intent transitions; E2E triggers the local `<video>` element events without directly emitting `video:action`, then checks action count, final revision/state, and no loop.
  - done: all three intended actions reach the server in order and all room clients converge within the existing time tolerance.
  - satisfies: R-02, R-07, R-12

- T-04 — Align playback guidance with permissions
  - files: `app/room/[roomId]/page.tsx`, `tests/e2e/permissions.spec.ts` or `tests/e2e/room.spec.ts`
  - action: select guest guidance from control mode and the current participant's approved grant.
  - verify: E2E observes each user-facing state in Everyone, Host only, Ask control before approval, and Ask control after approval/revoke.
  - done: the page never tells a permitted guest that only Host can control playback.
  - satisfies: R-03, R-05

- T-05 — Cover late join and participant lifecycle edges
  - depends on: T-01, T-02, T-03
  - files: `tests/e2e/playback.spec.ts`, `tests/e2e/room.spec.ts`, `tests/e2e/helpers.ts`
  - action: add late join/reload during playing, grace expiry with Host transfer, explicit leave, and stale session credential scenarios; poll for state changes rather than sleeping a fixed interval.
  - verify: compare stable participant IDs/count, Host ID, permission outcome, video revision/playing state, and currentTime within ±1 second.
  - done: lifecycle and late-join cases match D-01 and do not create duplicate participants or stale video state.
  - satisfies: D-01, R-04, R-06, R-08, R-13

- T-06 — Verify P2P recovery after Socket.IO reconnect
  - files: `tests/e2e/p2p.spec.ts`, `tests/e2e/helpers.ts`; `hooks/use-p2p-movie.ts` only if the E2E exposes a defect
  - action: force an ordinary Socket.IO reconnect for a participant without reloading its page; verify peer replacement and resumed media transfer for Host, Guest A, and Guest B.
  - verify: assert participant IDs/count remain stable, old peer connections close, new peers and data channels connect, bytes increase after reconnect, and browser error/external request collectors remain empty.
  - done: the offline P2P scenario recovers without page reload, public STUN, TURN, or fatal error.
  - satisfies: R-09, R-14

- T-07 — Run full requested verification
  - depends on: T-01, T-02, T-03, T-04, T-05, T-06
  - files: no additional files unless a failure requires a scoped fix
  - action: run the unit suite, typecheck, lint, production build, and offline Playwright E2E suite; fix failures within scope.
  - verify: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`.
  - done: every command exits successfully and no test opens external network access.
  - satisfies: R-10, R-11, R-12, R-13, R-14
