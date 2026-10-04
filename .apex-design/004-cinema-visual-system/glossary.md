# Glossary — WatchTogether cinematic visual system

| Term | Context | Meaning | Not to be confused with | Confirmed by |
|---|---|---|---|---|
| Landing | Public entry page | Light editorial page for creating or joining a room | Room | D-01 |
| Cinema room | Room UI | Dark video-first view for a live watch party | Backend room state | D-01 |
| Drawer | Room UI | One responsive pane selected by Queue, Chat, or People | Separate dashboard cards | D-02 |
| Source picker | Video UI | Inline floating choice for URL/RUTUBE or a computer movie | Transport/player implementation | D-03 |
| Owner | Authorization | Original room creator with local filesystem privileges | Current Host role | Existing room contract |
| Host | Room role | Current participant controlling Host-only room actions | Owner identity | Existing room contract |

## Forbidden synonyms

- `Host` -> do not use as synonym for `Owner` in labels or logic.
- `P2P Movie`, `Host Stream`, `HTTP Range` -> keep transport terms out of primary user-facing UI.

## Open terms

- None.
