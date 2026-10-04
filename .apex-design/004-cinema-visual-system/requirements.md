# Requirements — WatchTogether cinematic visual system

- R-01 — Landing defaults to an off-white editorial hero with the requested Russian headline, CSS room preview, and no visible create/join fields until an action is chosen (serves: distinct entry experience; depends on D-01, D-03).
- R-02 — Create and join continue using the existing room/socket contracts, invite parsing, owner/session tokens, and network lookup (serves: behavior parity; depends on D-03).
- R-03 — Room centers the video and exposes Queue, Chat, and People in one optional responsive drawer; source details remain available from “+ Добавить” (serves: video-first room; depends on D-02).
- R-04 — Queue, chat, participant presence, voice controls, permissions, and source actions preserve existing accessibility labels, test IDs where relevant, and event handlers (serves: no functional regression; depends on D-02).
- R-05 — At 375, 430, 768, 1024, 1440, and 1920 CSS pixels, landing and room have no horizontal overflow; mobile drawer is a bottom sheet and touch targets are at least 44px where primary (serves: responsive use; depends on D-01, D-02).
- R-06 — Keyboard focus remains visible, reduced-motion preferences disable nonessential transitions, and colors meet practical text contrast (serves: accessible use; depends on D-01).

## Failure and abuse scenarios

- R-07 — Visual-only changes cannot grant permissions, expose owner paths/tokens, or move secrets into user-facing room information (depends on D-02).
- R-08 — Hidden drawer panes remain mounted as needed so chat listeners and queue state do not reset when switching tabs (serves: realtime continuity; depends on D-02).
