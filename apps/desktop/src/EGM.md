# src (renderer)

## Overview
The React renderer. `main.tsx` mounts the app. `App.tsx` maps tab IDs to page components. `TerminalRoot.tsx` holds the shell. The data layer lives in `api/`, UI state in `stores/`, and pages in `pages/`. `mobile.html` is the phone entry point.

## Interface
- `main.tsx` - renderer entry point. Mounts the app into `index.html`.
- `App.tsx` - maps tab IDs to page components ([CLAUDE.md:Renderer data flow]).
- `TerminalRoot.tsx` - the terminal shell (navigation and chrome).
- `mobile.html` - phone entry point, served by the mobile HTTP route.
- `vite-env.d.ts` - Vite type declarations.
- Child packages: [./api/EGM.md](./api/EGM.md), [./charts/EGM.md](./charts/EGM.md), [./components/EGM.md](./components/EGM.md), [./input/EGM.md](./input/EGM.md), [./lib/EGM.md](./lib/EGM.md), [./mobile/EGM.md](./mobile/EGM.md), [./pages/EGM.md](./pages/EGM.md), [./stores/EGM.md](./stores/EGM.md).

## Invariants
- Renderer access goes through `window.api` only ([AGENTS.md:Coding Style]).
- Every implemented page preloads at startup, including pages the user has not visited ([AGENTS.md:Startup Page Readiness]).
- No global diagnostics banner ([AGENTS.md:No Global Diagnostics Banners]).

## Side Effects
- Renders the UI and calls `window.api` through the query hooks in `api/`.

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:readiness-ui` after a build (startup readiness)
