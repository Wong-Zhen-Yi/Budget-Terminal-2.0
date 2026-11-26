# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

The repository rules live in `AGENTS.md`: palette, page layout, Focus page independence, startup readiness, the ban on diagnostics banners, MCP sync, and user notes. They are imported here and are binding:

@AGENTS.md

## Commands

Run these from the repository root. The only workspace is `apps/desktop` (`budget-terminal-desktop`).

- `npm run dev` runs the root `scripts/dev.cjs`. On Windows it goes through `scripts/launch-windows.ps1 -Dev` to recover the Node runtime, then builds MCP and starts `electron-vite dev --watch`. The app is single-instance, so close any open window first.
- `npm run typecheck` runs `tsc --noEmit` (TypeScript 7). There is no linter or formatter.
- `npm run build` runs `build:mcp` and then `electron-vite build`, writing to `apps/desktop/out/`. It does not produce an installer.
- `node scripts/launch.cjs` launches a fixed production build.
- `npm run build:mcp` regenerates `mcp/schemas.json` and `mcp/output-schemas.json` and bundles `out/mcp/server.mjs` and `plugins/budget-terminal/server/server.mjs`. `npm run probe:mcp` checks that the schemas are current and runs the MCP access and workflow probes.

### Tests (probes)

There is no test runner. Each test is a standalone `tsx` script at `apps/desktop/scripts/probe-<area>.ts` that uses Node assertions.

- Run one probe: `npm run probe:charts -- --offline`. Many probes contact live providers unless you pass `--offline`. Live example: `npm run probe:stocks -- AAPL`.
- Probes not exposed at the root: `npm run probe:loading --workspace budget-terminal-desktop`. You can also run `npx tsx scripts/probe-<area>.ts` directly from `apps/desktop`.
- `*-ui` probes and `probe:security` drive real Electron windows and need `npm run build` first.
- Full maintenance pass after a build: `npm run probe:maintenance -- --ui` (offline plus UI, in isolated profiles). Run `npm run probe:maintenance-live` for public feeds. Results go to `apps/desktop/out/maintenance`.
- Launcher changes: `npm run probe:launcher`. Privacy guard: `npm run probe:agent-privacy`.

`docs/development.md` lists the standard verification set.

## Architecture

```
React renderer ─ window.api ─ IPC ─ registerServiceHandlers ─ electron/services ─ providers / JSON stores / cache
Mobile browser ─ HTTP /api/call/<channel> ─ (same handlers)
MCP clients ─ out/mcp/server.mjs ─ bridge ─ electron/mcp/routes.ts ─ (same handlers)
```

### Single contract, three transports
- `electron/shared/contract.ts` (very large) is the IPC contract. It defines the `CHANNELS` map, the `DesktopApi` interface, every request and payload type, `Envelope<T>`/`Freshness`, and the `TABS` page registry.
- `electron/shared/createApi.ts` turns `invoke`/`subscribe` functions into a `DesktopApi`. `preload.ts` passes it `ipcRenderer` and exposes the result as `window.api`. `src/mobile/client.ts` passes it `fetch('/api/call/<channel>')`, which `electron/services/mobileRoutes.ts` serves. Don't fork the API surface per transport.
- `electron/ipc/serviceHandlers.ts` registers every data/service channel. `handlers.ts` holds shell-only handlers.
- Services return `Envelope<T>` built with the `ok`/`partial`/`failed`/`err` helpers in `electron/shared/envelope.ts`. Partial failures degrade one panel and never blank the page. Keep missing values distinct from zero.

### Adding a service channel
1. Add the types and a `CHANNELS` entry in `contract.ts`.
2. Add the method to `createApi.ts`.
3. Register the handler in `serviceHandlers.ts`.
4. Classify the channel in `electron/mcp/routes.ts`. `createServiceRoutes` throws at startup if a registered channel is neither in the MCP allowlist (`mcp/operations.ts`, with descriptions and permissions in `mcp/catalog.ts`/`permissions.ts`) nor in `desktopOnlyChannels`.
5. Run `build:mcp` and `probe:mcp`, and update `docs/local-mcp.md`.

### Renderer data flow
- `src/api/*Queries.ts` are TanStack Query hooks over `window.api` (`src/api/client.ts` holds `api` and `queryKeys`). The query cache is persisted (`queryPersistence.ts`), so saved content renders at launch.
- Startup preloading of every page is implemented in `src/api/prefetch.ts`. `buildTasks` creates warm tasks per tab, and `startupScheduler.ts` runs, retries and refreshes them and reports readiness to `stores/dataHealth`, which Settings displays. A new page needs a warm task here as well as its query hooks, because of the startup-readiness rule.
- Page order and workspaces come from `electron/shared/navigation.ts` (`WORKSPACES`, `FOCUS_WORKSPACE`) together with `TABS`. `src/App.tsx` maps tab ids to page components.
- Zustand stores in `src/stores/` hold per-page UI selections such as symbol and timeframe. Prefetch reads them so the preloaded request matches what the page will ask for.
- Path aliases: `@shared/*` → `electron/shared/*`, `@/*` → `src/*`.

### Main process
- Yahoo access lives under `electron/services/yahoo/`. All requests go through `rateGate.ts`, and some run in a worker (`workerClient.ts`). Heavy work runs in `electron/workers/` (cache, quant).
- Other providers: Hyperliquid equity perps (preferred for mapped stock marks and candles), Finnhub when a key is saved, CoinGecko (shared app-wide request budget), FRED, SEC EDGAR, TickerTick, Polymarket and others. `docs/public-data-routing.md` describes provider precedence and labelling.
- Saved records (portfolio, cards, articles, settings) are JSON stores in the user's app data. MCP edits use compare-and-swap through `meta.revision`. Persistence probes must point `APPDATA`/`LOCALAPPDATA` at temporary directories.
- Security model: context isolation, sandboxed preload, no Node integration in the renderer, and IPC accepted only from the trusted main frame. Network fetches of article and thumbnail URLs enforce public addresses only.
- Other subsystems with their own docs: Agents (embedded Codex, `docs/agents.md`), Browser (`docs/browser.md`), Mobile Access over Tailscale (`docs/mobile-access.md`), Convex cloud sync (`apps/desktop/convex/`, `docs/convex-sync.md`), notifications and Telegram.

## Launchers and repository hygiene
- **Windows and Linux have 1:1 parity.** Every feature, command, option and behaviour must work the same on both. That includes every `btd` command and flag (`start`, `restart`, `mobile`, `update`, `-Dev`, `-Demo`, `-MobilePreview`, `-Logs`, `-Attached`, `-Setup`, `-RuntimeOnly`, `--help`), the double-click launcher, the connected mobile window and app features. Don't ship anything Windows-only or Linux-only: implement and verify it on both in the same change. The Windows side lives in `scripts/launch-windows.ps1` and `install-bt.ps1`. The Linux side lives in `scripts/launch.cjs` (`runCommandLine`), `launch-posix.sh` and `install-linux-launcher.cjs`. Keep the `btd --help` text identical on both.
- The double-click launchers are `launchers/windows/Launch Budget Terminal.cmd` and `launchers/linux/Launch Budget Terminal.sh`. Don't add others. The `.cmd` wraps `scripts/launch-windows.ps1`, which runs `scripts/launch.cjs`; the Linux `.sh` (and macOS directly) runs `scripts/launch-posix.sh`, which bootstraps Node via `scripts/bootstrap-mac.sh`/`bootstrap-linux.sh` when none is found. `npm run setup:linux` installs a desktop and app-menu entry pointing at the Linux launcher. Every path runs install, Electron check, build (including MCP) and verify before opening the app. Keep them on that shared path when changing startup, and run `npm run probe:launcher`.
- How the "update the double-click launcher" rule works in practice: each user-visible change adds or edits a one-line `rem The shared build ...` comment in `Launch Budget Terminal.cmd` (and a `# The shared build ...` comment in the Linux launcher). The launch logic doesn't change. See `git log --stat -- launchers` for examples.
- Demo and phone-preview builds have no launcher; start them yourself with `powershell -File scripts/launch-windows.ps1 -Demo` / `-MobilePreview` (or `btd -Demo`, `node scripts/launch.cjs --demo`). They copy `fixtures/demo-user-data.json` into a temporary profile. Use the demo for screenshots and UI smoke tests, never real data. The user never has to launch a demo build.
- Git hooks in `.githooks/` (installed by `npm install`): pre-commit and pre-push run `scripts/check-private-agent-data.cjs` to block Agents data and browser login profiles. Post-merge and post-checkout reinstall dependencies when a manifest changes.
- `output/` and `apps/desktop/out/` are ignored scratch and build directories. Don't commit them.
