# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

Run everything from the repo root; the root scripts forward into the `apps/desktop`
workspace.

```bash
npm run dev          # electron-vite dev — the supported entry point
npm run typecheck    # tsc --noEmit; run after touching any .ts/.tsx
npm run build        # bundles only; packaging is unverified and out of scope
```

There is no unit-test framework. `apps/desktop/scripts/probe-*.ts` **are** the test
suite: each runs the real services headless (no Electron) so their output can be compared
against the reference app. One probe per page/area, all listed in
`apps/desktop/package.json`; extend the matching probe rather than adding a parallel
harness.

```bash
npm run probe -- AAPL "1 Week"    # the core Yahoo services end to end
npm run probe:rate                # 20-symbol burst; fails on any 429
npm run probe:oil -- --offline    # most probes take --offline for the pure/fixture checks
npm run probe:stocks -- AAPL      # symbol-taking probes read argv after `--`
npm run patterns:png -- --check   # verify the cheat-sheet PNGs are current
```

Convention: a probe runs its offline assertions first, then hits the network unless
`--offline` is passed. Before finishing a change run `npm run typecheck` plus the probes
covering what you touched, and smoke-test the UI with `npm run dev`.

## What this repo is

An Electron + React + TypeScript rebuild of a PySide6 terminal app, ported page by page.
The reference checkout (`../Budget-terminal-pyside6`) is **not present in this
environment**; where it is available it is read-only and must never be edited. Comments
throughout the code cite reference symbols (`_p20_replay_market_cap_animation`,
`_dollar_volume_metrics`, `attach_market_data_result`) — those names are provenance for
why a calculation is shaped the way it is, and reproducing the reference's numbers
exactly is the acceptance criterion for a port.

All 35 tabs in `TABS` (`electron/shared/contract.ts`) are now `implemented: true`.
README.md documents what each page shows; read it before changing a page's behaviour.

## Architecture

Three layers under `apps/desktop/`, and the boundaries are load-bearing:

- **`electron/shared/`** — types, constants and pure maths imported by *both* processes.
  `contract.ts` (~3.5k lines) is the single IPC contract: request/payload types,
  `CHANNELS`, `DesktopApi` and `TABS`. Per-page maths lives beside it
  (`portfolioMath.ts`, `analytics.ts`, `financeMath.ts`, `oil.ts`, …) so the UI and the
  probes can never disagree. **No Electron or React imports here.**
- **`electron/services/`** — all data access, main process only. `provider.ts` implements
  the `MarketDataProvider` interface, the seam a FastAPI sidecar could later satisfy.
  `yahoo/` holds every Yahoo call; other hosts (SEC, EIA, CoinGecko, CNN, RSS feeds) get
  their own top-level service module.
- **`src/`** — React renderer. Reaches the outside world only through `window.api`
  (`src/api/client.ts`); `contextIsolation` on, `nodeIntegration` off, and a CSP of
  `default-src 'self'; img-src 'self' data:`.

Adding a feature that needs data touches these in order: `shared/contract.ts` (request +
payload types, a `CHANNELS` entry, a `DesktopApi` method) → a service in
`electron/services/` → `provider.ts` → `electron/ipc/handlers.ts` → `electron/preload.ts`
→ a hook in `src/api/*Queries.ts` with its key in `queryKeys` → the page.

Path aliases: `@shared/*` → `electron/shared/*`, `@/*` → `src/*` (declared in both
tsconfig.json and electron.vite.config.ts).

## Invariants that are easy to break

- **Every handler returns an `Envelope<T>`** (`data`, `meta`, `errors`) built with the
  helpers in `shared/envelope.ts` — `ok` / `partial` / `failed`. A feed that fails shows
  its own panel error and does not take the page down. A *refused* mutation is a normal
  `partial` outcome, not a thrown exception.
- **Reach Yahoo only through `paced()`** (`services/yahoo/client.ts`). A direct `yahoo.*`
  call skips the rate gate and Yahoo 429s an unpaced fan-out. This is a rule about Yahoo,
  not about the network: the non-Yahoo hosts deliberately stay *outside* the gate, so one
  slow publisher or CoinGecko's free tier cannot throttle the whole app.
- **The rate gate has two lanes, and the flag never reaches a cache key.** A request
  carrying `background: true` (set only by the startup warm-up in `src/api/prefetch.ts`)
  yields to every queued foreground waiter and may not take the last concurrency slot.
  The lane rides an `AsyncLocalStorage` entered by the `handle` wrapper in
  `ipc/handlers.ts`, so it propagates through every `await` without any call site knowing
  about it. Scheduling is not identity: a warmed payload and a user-requested one must be
  the same `TtlCache` entry. `RateGate`'s wake timer is deliberately not `unref`'d, or
  the probes exit silently mid-burst.
- **Stores are owned by this app and written through a queue.** `portfolioStore.ts`,
  `cardsStore.ts` and `settingsStore.ts` write under `%APPDATA%\BudgetTerminalElectron\`,
  resolving paths from the environment (not Electron's `app`) so the probes reach the
  same files. Legacy PySide6 files under `%LOCALAPPDATA%\BudgetTerminal\` are read once
  to seed and never written. Every mutation goes through the write chain, re-reads,
  normalises, and persists atomically; it returns the whole re-read document so the
  renderer never guesses post-write state. Exports join the same chain, or a backup comes
  out one edit behind. Only ENOENT or a `SyntaxError` may fall back to a seed — any other
  read error must throw, or a transient EBUSY/EPERM wipes the live book.
- **The query cache's one-hour `gcTime` (`src/main.tsx`) is what makes tab switches
  cheap.** `App.tsx` renders one page at a time, so the 5-minute default would silently
  undo both the `staleTime: Infinity` nearly every hook sets and the startup warm-up. A
  warm task must prime with the *exact* `staleTime` its hook asks for, and `useReloadAll`
  must filter `{ type: 'active' }`.
- **`PAGE_KEEP_ALIVE` in `App.tsx` is an allowlist, not a default.** A page may only join
  it if it neither polls on a timer nor gates queries on being visible.
- **Timestamps are seconds** in `Candle`/`IndicatorPoint` (what lightweight-charts wants)
  and **milliseconds** in news payloads. lightweight-charts is **v5**: use
  `chart.addSeries(SeriesDefinition, options, paneIndex)`.
- **Vite is pinned to 7** because electron-vite 5 caps there, which pins
  `@vitejs/plugin-react` to 5. Installing plugin-react 6 pulls Vite 8 and breaks the
  build with duplicate-Vite type errors.
- **Formatting lives in `src/lib/format.ts`** and the type scale in
  `src/styles/theme.css` (`--text-2xs`/`--text-xs`/`--text-sm`). Do not inline `toFixed`
  in a component or hard-code sizes; persisted column widths in `stores/dashboard.ts`
  need a `STORE_VERSION` bump when the scale moves.
- **Images reach the renderer as `data:` URIs from the main process.** The CSP blocks a
  raw `https://` `<img>` silently, and relaxing it would turn every feed-supplied URL
  into a tracking beacon.
- **History is auto-adjusted and windows are calendar-based** (`windowStart` in
  `yahoo/history.ts`) — except dollar-volume work, which needs unadjusted
  `close * volume` via `fetchCloseVolume`. Chart payloads need the trailing-bar cleanup
  (`dropSyntheticQuoteBar`, `dropPartialTrailingBar` in `yahoo/chart.ts`); removing
  either corrupts the quote header and every indicator.

## Style

Two-space indent, single quotes, no semicolons, trailing commas, strict TypeScript
(`noUnusedLocals` and `noUnusedParameters` are on). `PascalCase` for components and
types, `camelCase` for functions and service modules, `useX` for hooks,
`PascalCase.tsx` for component files. Comments here explain *why* a rule exists, usually
against the reference — match that density rather than narrating what the code does.

Commits use short imperative summaries (`Add Bonds page; harden options/projections
logic`). Never commit generated output (`out/`), credentials, or user data.
