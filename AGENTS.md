# Repository Guidelines

## Project Structure & Module Organization
Budget Terminal 2.0 is an Electron + React + TypeScript application in the `apps/desktop` npm workspace. Treat this repository as the application source of truth.

- `src/pages/` contains page components; `components/`, `charts/`, `api/`, and `stores/` hold reusable UI, charts, query hooks, and state.
- `src/assets/` and `src/styles/` contain assets and shared styling.
- `electron/services/` handles data access and persistence; `electron/ipc/` and `preload.ts` connect services to the renderer.
- `electron/shared/` contains contracts, types, and pure calculations shared across processes.
- `scripts/probe-*.ts` contains verification scripts; `docs/chart-patterns/` contains chart reference images. Generated bundles go into `apps/desktop/out/`.

## Build, Test, and Development Commands
Run commands from the repository root:

- `npm install` installs workspace dependencies and bootstraps Electron.
- `npm run ensure:electron` verifies or bootstraps the Electron runtime when startup reports a missing installation.
- `npm run dev` starts the Electron application with electron-vite.
- `npm run typecheck` checks TypeScript without emitting files.
- `npm run build` produces bundles; it does not create an installer.
- `npm run probe:charts -- --offline` runs deterministic chart checks.
- `npm run probe:stocks -- AAPL` exercises stock services with live data.

Find additional probes in `apps/desktop/package.json`; workspace-only scripts use `npm run <script> --workspace budget-terminal-desktop`.

## Coding Style & Naming Conventions
Follow existing TypeScript style: two-space indentation, single quotes, and no semicolons. Use PascalCase component filenames (`StocksPage.tsx`), camelCase functions and variables, and `*Queries.ts` for query modules. Preserve strict typing and use `import type` for type-only imports. No ESLint or Prettier configuration is present.

Keep renderer access behind `window.api`, shared calculations free of React/Electron imports, service responses within `Envelope<T>`, and Yahoo requests behind the shared rate gate.

## Startup Page Readiness
When Budget Terminal opens, start loading every implemented page, including pages the user has not visited. Once startup loading completes, switching to any page must show its ready content without a first-visit load. Do not limit startup loading to the active page, favorites, or recent pages, and do not defer a page's initial data load until its tab is selected. Keep startup progress and failures visible so a page that could not load is not silently treated as ready. Preserve this behavior when changing navigation, caching, query hooks, or data services.

## Testing Guidelines
Tests are standalone `tsx` probes using Node assertions or explicit checks; no coverage threshold is configured. Extend the matching `probe-<area>.ts`. Run typecheck and relevant offline probes for code changes, live probes for provider changes, and a UI smoke test for visible changes. Persistence probes must redirect `APPDATA` and `LOCALAPPDATA` to temporary directories.

## Commit & Pull Request Guidelines
Use concise, imperative commit subjects, matching history: `Improve charts load status & refresh behavior`. Keep commits focused. PRs should describe the problem, resulting behavior, validation commands and outcomes, related issues when applicable, and screenshots for UI changes. Preserve unrelated working-tree edits and exclude generated bundles, credentials, and personal data.
