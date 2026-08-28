# Repository Guidelines

## Project Structure & Module Organization

This npm workspace contains the Electron client in `apps/desktop/`. Main-process code lives in `electron/`: keep shared logic in `electron/shared/`, data access in `electron/services/`, and channels in `electron/ipc/`. The React renderer is under `src/`, organized into `pages/`, `components/`, `api/`, `stores/`, `lib/`, `charts/`, and `styles/`. Verification scripts live in `scripts/probe*.ts`; generated output belongs in `out/`.

## PySide6 Porting Workflow

This app is an incremental port of `../Budget-terminal-pyside6`, the source of truth for existing features. Before porting a page, read its mixin and linked workers, services, widgets, persistence code, and smoke tests; also read that checkout's `AGENTS.md` and `CLAUDE.md`. Preserve user-visible behavior, calculations, defaults, and edge cases while adapting them to Electron/React boundaries—do not copy Qt threading or UI structure literally. Compare both apps side by side and extend the matching Electron probe. Do not modify the PySide6 checkout unless explicitly requested.

## Build, Test, and Development Commands

- `npm install` installs dependencies; Node 24 and npm 11 are known-good.
- `npm run dev` starts Electron through Vite and is the supported local entry point.
- `npm run typecheck` runs strict TypeScript validation without emitting files.
- `npm run probe -- AAPL "1 Week"` exercises the market-data services headlessly.
- `npm run probe:portfolio` validates portfolio output; area-specific probes are listed in `apps/desktop/package.json`.
- `npm run build` creates bundles, but packaging is not yet a verified release path.

## Coding Style & Naming Conventions

Use two-space indentation, single quotes, no semicolons, multiline trailing commas, and strict types. Use `PascalCase` for React components/types, `camelCase` for functions/variables, and `useX` for hooks. Component files use `PascalCase.tsx`; service modules use descriptive `camelCase.ts`. Renderer code must use `window.api`; route Yahoo calls through the rate gate and preserve `Envelope<T>` error isolation.

## Testing Guidelines

There is no unit-test framework or coverage threshold; probes are the verification suite. Run `npm run typecheck`, then the probes covering the modified area. Add focused checks to `probe-<area>.ts` when extending behavior. Smoke-test UI changes with `npm run dev`.

## Commit & Pull Request Guidelines

Use short, imperative commit summaries such as `Add Settings page and navigation controls`. Pull requests should explain the change, affected pages/services, verification commands, and data effects. Link issues and attach before/after UI screenshots. Never commit generated output, credentials, or user data.
