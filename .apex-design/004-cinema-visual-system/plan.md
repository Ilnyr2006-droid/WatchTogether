# Plan — WatchTogether cinematic visual system

- T-01 — Establish tokens and landing system
  - files: `app/globals.css`, `app/page.tsx`, `components/landing/*`, `components/logo.tsx`, `app/layout.tsx`
  - action: add responsive editorial landing, mock preview, progressive disclosure, and warm/cinema tokens
  - verify: E2E room creation/join and responsive viewport checks
  - done: no horizontal overflow at required widths; session/invite behavior unchanged
  - satisfies: D-01, D-03, R-01, R-02, R-05, R-06
- T-02 — Build video-first room shell and responsive drawer
  - files: `app/room/[roomId]/page.tsx`, `components/room/room-drawer.tsx`, `components/video/video-player.tsx`
  - action: add floating topbar, metadata disclosure, one tabbed drawer, source picker, portal the queue
  - verify: room, playlist, playback, chat, permissions, reconnect, P2P, host-stream E2E
  - done: all existing room actions work from the new composition
  - satisfies: D-02, R-03, R-04, R-07, R-08
- T-03 — Refine room content and validate all widths
  - files: `components/chat/chat-panel.tsx`, `components/room/participants.tsx`, `components/room/control-settings.tsx`, `tests/e2e/*`
  - action: reduce panel/badge noise; verify semantic selectors, touch layout, and motion preferences
  - verify: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, `npm run test:e2e`
  - done: all required checks pass and no room function is removed
  - satisfies: R-04, R-05, R-06
