# Design

## Accepted design

Add a dedicated `LocalMediaRegistry`; do not place file paths in `RoomState` or reuse the single-active-file HostStreamRegistry as a playlist store. Keep registry records and active transfer handles in process memory, keyed by room and random media ID. Existing per-socket stream-token authorization is extended with an Owner identity check for filesystem endpoints and remains required for each GET/HEAD.

`RoomManager` owns the public playlist, current item ID, playback source and revision. New playlist operations are validated at the Socket.IO boundary and rechecked in RoomManager. Direct URL/RUTUBE source changes keep their existing room permission behavior and are represented in the playlist. Queue play/remove/reorder/clear and automatic advancement are Host-only. Automatic-next is accepted only while the ended item remains current; this makes duplicate `ended` events harmless.

The media handler canonicalizes a selected path with `realpath`, accepts only supported browser containers, checks regular-file metadata, parses a single byte range, and pipes `createReadStream({start,end})` into the response. Each transfer is tracked by current socket so takeover/disconnect can destroy it. Room deletion clears media records and streams.

The UI exposes URL/RUTUBE and Film from computer. Owner-only path/picker controls register a file; all participants see safe name/size and per-participant ready state. HTML5 loaded data updates the existing participant `ready` flag. For a local movie, browser duration plus server-reported file size yields an explicitly approximate average bitrate/upload estimate.

## Boundaries

- No durable persistence, cross-process coordination, or room restart recovery.
- No codec probing/transcoding. Unsupported extensions are rejected at registration; browser codec errors explain direct-play limitations.
- RUTUBE auto-next is excluded; explicit Host next remains available.
- P2P remains implemented and testable in E2E mode, but production UI does not expose transport selection.
