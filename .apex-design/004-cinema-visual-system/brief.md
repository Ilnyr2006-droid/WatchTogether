# WatchTogether cinematic visual system

- Status: in progress
- Decision owner: requester
- Created: 2026-10-04

## Problem and outcome

The landing and room currently look like a generic dark SaaS dashboard. Reframe the product as a typographic, minimal watch-party experience with a warm editorial landing and a quiet cinema room. Existing room behavior must remain intact.

## Scope

- Landing composition, progressive create/join disclosure, static HTML/CSS room preview, editorial product sections.
- Room topbar, video-first workspace, source picker, one Queue/Chat/People drawer across desktop and mobile.
- Shared design tokens, touch layouts, keyboard focus, reduced motion, responsive E2E coverage.

## Non-goals

- No Socket.IO, identity, reconnect, authorization, VideoState, playlist, voice, stream, P2P, API, or persistence changes.
- No production deployment/restart, backend feature, external font, or PWA behavior change.

## Constraints and facts

- Fact: current client uses React components for the players, chat, voice, permissions, and queue; those handlers remain the behavior boundary.
- Fact: room state and playlist are realtime and the E2E suite uses local fixtures.
- Decision D-01: use warm off-white editorial landing and near-black cinema room with a restrained periwinkle accent; avoid generic gradient cards.
- Decision D-02: expose one responsive Queue/Chat/People drawer; render existing queue content into its Queue pane without moving its socket logic.
- Decision D-03: reveal create/join forms only after the user selects an action; preserve invitation parsing and session storage behavior.

## Open questions

- None blocking; the supplied design brief defines the intended direction.
