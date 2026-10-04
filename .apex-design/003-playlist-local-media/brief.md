# Playlist and Owner-local media

- Status: implementing
- Decision owner: requester
- Created: 2026-10-04

## Outcome

Expose two source choices: URL/RUTUBE and a movie on the WatchTogether backend machine. Keep transport details internal, add a room-scoped playlist, and stream registered local files without transcoding.

## Scope

- Stable Owner authorization, distinct from the current Host role.
- Private local-media registry, safe public metadata, authenticated Range/HEAD endpoint, and cleanup on room destruction or socket takeover.
- Server-authoritative playlist mutations and playback transitions using the existing video revision and permissions.
- HTML5 readiness, local-media upload estimate when duration is known, and local Playwright coverage.

## Constraints

- Preserve participant/session recovery, Host transfer, existing `VideoState.revision`, playback permissions, voice, and P2P signaling/player code.
- Keep local filesystem paths server-only; do not persist playlist/room state beyond the existing in-memory lifecycle.
- No database, Redis, FFmpeg, re-encoding, or user-facing transport selector.
- Tests use loopback and local MP4 fixtures only.

## Assumptions

- Current deployment remains one Node process with ephemeral rooms; playlist and media registry share that room lifecycle.
- The server-side Owner may select by native picker where supported or submit a local path through Owner-only authenticated UI.
