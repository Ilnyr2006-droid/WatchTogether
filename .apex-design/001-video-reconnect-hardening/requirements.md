# Requirements — Video timing, playback intent, and reconnect edge cases

- R-01 — For any playing state snapshot at server time `t`, the returned `currentTime` is advanced through `t` and the returned `updatedAt` is anchored at `t`; applying `effectiveVideoTime` immediately afterward does not count that interval again. Snapshot generation does not mutate the stored state or change its revision. (serves: correct playback for late join/reload; no dependency on D-01/D-02)
- R-02 — After a permitted local play or pause event is emitted, the local desired-playback intent immediately reflects that event. A following opposite event is not suppressed solely because the server response has not arrived; remote state application still emits no feedback action. (serves: responsive, ordered playback; no dependency on D-01/D-02)
- R-03 — The room guidance says guests can control in Everyone, says control is approved for a granted participant in Ask control, and says Host controls playback for an unapproved participant or Host only. (serves: users understand their effective permission; depends on D-02 for the retained-grant case)
- R-04 — The original owner's ability to recover Host after grace expiry or explicit leave follows exactly the D-01 policy, with unit and E2E evidence; stale session credentials do not create a duplicate participant. (serves: predictable, secure room ownership; depends on D-01)
- R-05 — Switching between control modes follows D-02 for approved grants; pending requests are cleared when Ask control is turned off and cannot appear as stale requests on re-entry. (serves: predictable participant permissions; depends on D-02)
- R-06 — A Guest joining or reloading during playback receives the latest revision and reaches the same playing state and a playhead within ±1 second of peers, without a timestamp double-count. (serves: consistent late join and reconnect; supports R-01)
- R-07 — The local HTML video element can perform rapid Play → Pause → Play; all three intended actions reach the server in order, clients converge to the final state/revision, and remote application does not produce a feedback loop. (serves: reliable playback under quick input; supports R-02)
- R-08 — E2E verifies 30-second grace expiry and Host transfer, explicit leave, and rejection/recovery behavior for removed session credentials in accordance with D-01. Assertions are based on observable state and participant IDs. (serves: lifecycle behavior is durable and unambiguous; depends on D-01)
- R-09 — After an ordinary Socket.IO reconnect without page reload, the same P2P participant reconnects without a duplicate, stale peer connections are replaced, and both guests can receive media again from the Host with local test networking. (serves: resilient P2P movie viewing; no dependency on D-01/D-02)
- R-10 — All scoped automated checks pass: `npm test`, `npm run typecheck`, `npm run lint`, `npm run build`, and `npm run test:e2e`; E2E uses local fixtures and remains behind `WATCHTOGETHER_E2E=true`. (serves: safe regression coverage; depends on R-01 through R-09)

## Failure and abuse scenarios

- R-11 — A room update or join snapshot must not cause a stale timestamp to add elapsed time twice, change the authoritative revision, or overwrite a newer video state.
- R-12 — Remote play/pause application must not generate an infinite `video:action` → revision → state cycle.
- R-13 — Removed participant credentials must not create a duplicate identity or bypass the selected Host ownership policy; the owner recovery secret must never be placed in the invite URL or exposed to guests.
- R-14 — A failed P2P reconnect must be visible as a recoverable connection state, not a fatal uncaught browser error; existing peer connections must be closed before replacement.
