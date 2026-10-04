# Implementation plan

1. Extend realtime types and Zod validation for Playlist, Owner flags, and queue operations.
2. Add Owner authorization and RoomManager playlist operations; preserve authoritative video revisions and permissions.
3. Implement LocalMediaRegistry and authenticated GET/HEAD/Range endpoints, including transfer and room lifecycle cleanup.
4. Wire Owner path/native picker APIs and Socket.IO playlist events, unavailable-file reporting, and duplicate-safe automatic next.
5. Replace user-facing source transport choices with URL/RUTUBE and computer movie; add playlist/readiness/upload diagnostics.
6. Add unit/integration and local multi-context Playwright coverage; run the requested test, typecheck, lint, build, and E2E commands.
