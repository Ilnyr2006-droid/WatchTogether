# Design — WatchTogether cinematic visual system

## Decision digest

Adopt a warm editorial landing and near-black cinema room using shared tokens and a restrained periwinkle accent. Make the video the room's primary surface and consolidate Queue, Chat, and People into one responsive drawer. Keep existing behavior components and render the queue into the drawer with a portal. The main risk is changed E2E visibility assumptions; semantic helpers and responsive checks cover it. Reopen only if the new UI changes existing authorization or media behavior.

## Recommendation

Use scoped CSS tokens plus semantic layout classes rather than a component-library migration. Separate landing preview and drawer composition into small React components; preserve player/socket components and their protocol responsibilities.

## Alternatives considered

- Keep current dashboard and restyle its cards: less implementation work but retains the layout the brief explicitly rejects.
- Rewrite all room controls into new components: clean boundary but larger functional risk around queue and authorization flows.
- Recommended: change page composition, drawer presentation, and styling while keeping handlers and state owners in current components.

## Contracts and data

- No backend event or payload changes.
- Room tabs are local presentation state only.
- Queue DOM mounts into the drawer via React portal; playlist state/actions remain in VideoPlayer.
- Landing reveals forms progressively but submits through current socket and invitation paths.

## Failure, security, and privacy

- Room IDs and technical diagnostics move behind an explicit Room info disclosure.
- No secret-bearing invite URL is added to a public static asset or cache.
- Owner-only file actions remain guarded by existing UI and authenticated request logic; server checks remain authoritative.

## Operations

Validate with unit/type/lint/build and local Playwright; do not activate the changes on production as part of this task.

## Risks and revisit conditions

- Hidden tabs can make tests miss user-visible behavior; tests explicitly open the relevant tab.
- Portal mounting can briefly be empty during first render; queue appears when the drawer host ref is committed.
- Revisit if mobile browser viewport behavior causes bottom-sheet overlap or if actual users prefer a persistent drawer.
