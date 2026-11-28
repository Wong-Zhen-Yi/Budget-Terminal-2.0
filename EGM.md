# Budget Terminal 2.0 Blueprint

## System Overview
Budget Terminal 2.0 is a desktop workspace for market research, portfolio tracking, and personal finance. It is an Electron + React + TypeScript application. The only npm workspace is `apps/desktop` ([AGENTS.md:Project Structure], [CLAUDE.md:Commands]).

Data moves through three transports over one contract:
- React renderer → `window.api` → IPC → `registerServiceHandlers` → `electron/services` ([CLAUDE.md:Architecture]).
- Mobile browser → HTTP `/api/call/<channel>` → the same handlers.
- MCP clients → `out/mcp/server.mjs` → bridge → `electron/mcp/routes.ts` → the same handlers.

## Subdirectories & System Boundaries
- `apps`: [./apps/EGM.md](./apps/EGM.md) - Application workspace; contains the `budget-terminal-desktop` package.
- `docs`: [./docs/EGM.md](./docs/EGM.md) - Guides and design references. Only two design render scripts are code.
- `launchers`: [./launchers/EGM.md](./launchers/EGM.md) - Double-click launcher wrappers. The only allowed launchers are `launchers/windows/Launch Budget Terminal.cmd` and `launchers/linux/Launch Budget Terminal.sh` ([AGENTS.md:User notes]).
- `scripts`: [./scripts/EGM.md](./scripts/EGM.md) - Root launch, install, update, and verification scripts.

Tracked directories without code are not contracted: `fixtures/` (demo data JSON), `plugins/` (MCP plugin manifest and skill), `.claude-plugin/` (marketplace manifest). Hidden directories (`.githooks/`) are skipped by the discovery rules. `floorplan/` is untracked and was not scanned.

## Global Invariants
- The locked dark palette stays in place. No light mode, no recolouring without an explicit request ([AGENTS.md:Locked Colour Scheme]).
- Every implemented page preloads at startup. Switching to any page shows ready content without a first-visit load ([AGENTS.md:Startup Page Readiness]).
- No global diagnostics banner. Startup detail belongs in Settings ([AGENTS.md:No Global Diagnostics Banners]).
- Windows and Linux launchers keep 1:1 feature parity ([CLAUDE.md:Launchers and repository hygiene]).
- MCP edits to saved records use compare-and-swap through `meta.revision` ([CLAUDE.md:Main process]).
- The repository is public. No credentials, personal data, or Agents data may be committed ([AGENTS.md:User notes], [.githooks/pre-commit]).

## Global Side Effects
- Saved records (portfolio, cards, articles, settings) are JSON stores in the user's app data directory ([CLAUDE.md:Main process]).
- Optional cloud sync through Convex ([apps/desktop/convex/EGM.md](./apps/desktop/convex/EGM.md)).
- Outbound requests to public market-data providers, including Yahoo, Hyperliquid, Finnhub, CoinGecko, FRED, SEC EDGAR, TickerTick, and Polymarket ([CLAUDE.md:Main process]).
- `npm run build` writes bundles to `apps/desktop/out/` and produces no installer ([CLAUDE.md:Commands]).

## System Verification
- Run: `npm run typecheck`
- The root and `apps/desktop` define no `test` script. Verification uses typecheck plus the `probe:*` scripts. `npm run probe:mcp` covers MCP changes; `npm run probe:launcher` covers launcher changes ([CLAUDE.md:Tests (probes)]).
