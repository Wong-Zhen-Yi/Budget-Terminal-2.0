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

## Locked Colour Scheme
Preserve the current Budget Terminal dark colour scheme. Do not replace the palette, introduce a light mode, or recolour existing pages, navigation, controls, or charts unless the user explicitly requests a colour change. New UI must use the existing palette and semantic colour roles.

The shared palette in `apps/desktop/src/styles/theme.css` is the source of truth:

| Role | CSS token | Locked value |
| --- | --- | --- |
| Background | `--color-bg` | `#080b12` |
| Surface | `--color-surface` | `#0d1420` |
| Raised surface | `--color-surface-raised` | `#121b2b` |
| Hover surface | `--color-surface-hover` | `#172233` |
| Border | `--color-border` | `#1e2b3f` |
| Strong border | `--color-border-strong` | `#2c3e59` |
| Primary text | `--color-text` | `#d5dee9` |
| Muted text | `--color-text-muted` | `#7d8ea6` |
| Dim text | `--color-text-dim` | `#56677f` |
| Blue accent | `--color-accent` | `#2f6fd0` |
| Accent hover | `--color-accent-hover` | `#3b82e8` |
| Dim accent | `--color-accent-dim` | `#1b3f7a` |
| Positive / up | `--color-up` | `#26c281` |
| Negative / down | `--color-down` | `#f0554e` |
| Warning / flat market | `--color-warn` | `#d6b25e` |
| Positive background | `--color-up-bg` | `#0f2a20` |
| Negative background | `--color-down-bg` | `#2d1517` |

Reuse these tokens instead of adding competing hard-coded theme colours. Preserve existing page-specific and chart-series colours and their meanings; do not use this guideline to proactively recolour them. Keep the dark navy surfaces, cool light text, blue interactive accents, green gains, red losses, and amber warnings consistent across future changes.

## Page Layout
Pages should always aim to fit neatly within a single application viewport without scrollbars or large unused empty spaces (voids), unless explicitly specified otherwise. Keep content readable, balanced, and well spaced when designing or changing a page. Apply this guideline to future UI work; do not proactively redesign existing pages solely to enforce it.

## Startup Page Readiness
When Budget Terminal opens, start loading every implemented page, including pages the user has not visited. Once startup loading completes, switching to any page must show its ready content without a first-visit load. Do not limit startup loading to the active page, favorites, or recent pages, and do not defer a page's initial data load until its tab is selected. Keep startup progress and failures visible in Settings so a page that could not load is not silently treated as ready. Preserve this behavior when changing navigation, caching, query hooks, or data services.

## Testing Guidelines
Tests are standalone `tsx` probes using Node assertions or explicit checks; no coverage threshold is configured. Extend the matching `probe-<area>.ts`. Run typecheck and relevant offline probes for code changes, live probes for provider changes, and a UI smoke test for visible changes. Persistence probes must redirect `APPDATA` and `LOCALAPPDATA` to temporary directories.

## Commit & Pull Request Guidelines
Use concise, imperative commit subjects, matching history: `Improve charts load status & refresh behavior`. Keep commits focused. PRs should describe the problem, resulting behavior, validation commands and outcomes, related issues when applicable, and screenshots for UI changes. Preserve unrelated working-tree edits and exclude generated bundles, credentials, and personal data.

## User notes
update all double click launchers everytime a change is made
This is a public repo make sure that there are no private information like passwords, emails and API keys especially for the browser page

## No Global Diagnostics Banners
The **Page Loading Status banner** (also called the **startup diagnostics banner**, formerly the `LoadingStatus` component) is the full-width strip above page content showing "Pages X/Y ready", "Page needs attention", "Showing saved content", retrieval timestamps, raw errors, and retry buttons. The user has repeatedly requested its removal. Do not restore it or add an equivalent global diagnostics strip. Keep detailed startup progress, failures, and diagnostics in Settings. Preserve startup preloading for every implemented page. Keep page labels free of readiness status notes such as Ready, Refreshing, Incomplete or Failed; detailed diagnostics belong in Settings. The bottom status strip must also remain hidden.
