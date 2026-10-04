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

- T-08 — Restore authoritative playback after permission loss and clean replaced socket streams
  - files: `hooks/use-video-sync.ts`, `hooks/use-rutube-player.ts`, `lib/video-sync.ts`, `server/room-manager.ts`, `server/socket-server.ts`, playback/permission/stream lifecycle tests
  - action: detect only the `canControl: true → false` edge and force-apply the latest authoritative state in HTML5/P2P and RUTUBE players; invalidate the replaced socket's stream token and close its active transfers during session takeover.
  - verify: unit-test all four previous/current permission combinations; E2E-delay a Guest play until after Host revoke and assert `FORBIDDEN`, unchanged server revision, restored paused/playhead state and peer convergence; test stream token and transfer cleanup on takeover.
  - done: the permission-loss rollback does not emit a compensating action, and old stream resources cannot outlive their replaced socket.
  - satisfies: R-15, R-16

- T-09 — Add install metadata, safe static caching, and offline shell
  - files: `app/layout.tsx`, `app/manifest.ts`, PWA registration component, `public/sw.js`, `public/offline.html`, icons, offline UX component, page entry points, PWA E2E tests
  - action: provide standalone manifest/meta/icons; use a versioned network-first static allowlist with `skipWaiting`/`clients.claim`; serve only a token-free offline shell on failed navigations; show the required network message without simulating room state.
  - verify: Playwright reads the manifest, confirms the worker controls a page, proves dynamic API/room/query URLs are absent from Cache Storage, and opens the offline shell after network loss.
  - done: only safe static resources and the offline shell are cached; all room and media operations remain realtime/network-only.
  - satisfies: R-17, D-03

- T-10 — Add feature-detected PiP and permission-aware Media Session controls
  - files: `lib/mobile-media.ts`, `hooks/use-picture-in-picture.ts`, `hooks/use-media-session.ts`, `hooks/use-video-sync.ts`, `hooks/use-rutube-player.ts`, HTML5/P2P/RUTUBE player components, mobile control styling, helper and E2E tests
  - action: add PiP controls to native HTML5/P2P video; publish safe metadata and validated position state; route system play/pause/seek through existing video events or RUTUBE commands and make denied actions inert.
  - verify: unit-test capability detection, seek conversion, permission gates, and invalid position states; E2E mocks unsupported/supported PiP and exercises Media Session under Host only and Everyone.
  - done: unsupported APIs add no UI/errors, authorized controls use normal synchronization, and unauthorized system actions cannot change the video element or server state.
  - satisfies: R-18, D-03

- T-11 — Run requested regression suites
  - depends on: T-09, T-10
  - files: no additional files unless a scoped failure requires a fix
  - action: run `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:e2e`.
  - verify: all commands exit successfully; Playwright remains local-only with no outside services.
  - done: all prior realtime, reconnect, P2P, voice, chat, and new mobile/PWA coverage passes together.
  - satisfies: R-17, R-18
