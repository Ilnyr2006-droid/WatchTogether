# Glossary

- **Owner**: Initial room creator, proven by the private `ownerToken`; only Owner can access backend filesystem operations.
- **Host**: Current playback/room leader; may transfer to another participant and does not inherit Owner filesystem access.
- **LocalMediaRegistry**: Process-local private mapping from random media IDs to canonical filesystem records and active response streams.
- **LocalMediaPublic**: Safe client metadata (`mediaId`, filename, size); never includes a path or token.
- **Playlist item**: Room-scoped remote URL/RUTUBE source or registered local media reference.
- **Current item**: Playlist entry currently represented by authoritative `VideoState.source`.
- **Revision**: Existing monotonically increasing server-assigned `VideoState.revision`; playlist playback transitions advance it through the current RoomManager path.
- **Stream token**: Existing short-lived per-socket capability, checked for every local media request and invalidated on disconnect/takeover.
