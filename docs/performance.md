# Performance and retention

Quant pair discovery cleans histories once, prescreens aligned return correlations,
and calculates full spread statistics only for shortlisted pairs. Discovery and
custom pair details execute in a dedicated worker. Market requests retain the
existing provider rate gate. Worker failures reject current work; subsequent work
starts a new worker. Each admitted calculation has a 90-second timeout.

The SQLite market cache has a separate worker. It batches mutations for up to
25 milliseconds, coalesces access timestamps every 30 seconds, and maintains
incremental size accounting. Pruning runs when the disk budget is exceeded rather
than scanning on every write. Reads and explicit flushes preserve mutation order;
orderly application shutdown drains accepted writes before closing SQLite.
The existing database schema and V8 blob format remain compatible. Cache reads,
writes, deletion, clearing, and closing are asynchronous internal interfaces.

Automatic payload budgets are:

| Owner | Budget | Retention |
| --- | --- | --- |
| Service memory | 128 MiB, 5,000 entries | Least recently used values leave memory; disk snapshots remain reusable |
| Pending disk writes | 8 MiB | Backpressure allows one oversized operation when the queue is otherwise empty |
| Additional renderer queries | 64 MiB, 1,000 queries | Inactive queries expire after 15 minutes or leave sooner under pressure |
| Service disk snapshots | 512 MiB | Existing retention priorities; prune to 90% after crossing the budget |
| Renderer disk snapshots | 64 MiB, seven days | Memory eviction does not delete saved snapshots |

These are serialized-payload estimates, not process-RAM ceilings. Every page's
startup queries, including dependent histories and partial results, stay pinned
for the renderer session. Observed and fetching queries are protected from memory
eviction. Local records and live sessions retain their separate owners. Startup
still loads every implemented page and reports failures visibly.

The shared table virtualizes datasets of 200 or more rows, with eight overscan
rows on each side. Rows are measured for wrapped content. Focused editors remain
mounted, and sorting, filtering, exports and row callbacks use the full dataset.
Smaller tables keep their ordinary rendering path.

## Verification

Live market packets are coalesced over 50 milliseconds. A symbol index routes each
batch only to affected prepared queries, including inactive pages; distinct candle
timestamps remain ordered. Candle replacements reuse Wilder RSI state anchored
before the current bar and update only indicator tails. Initial histories and
retention-window shifts reseed exactly. Intraday moving averages remain daily-derived.
Dashboard, workstation, mini, crypto and shared candlestick plots use incremental
series updates for live tail changes; corrected histories and context changes
still replace the complete series. User zoom/pan is preserved unless auto-follow
or replay explicitly requests fitting.

Renderer persistence reuses snapshot size calculations and checkpoints live-only
changes every 15 seconds rather than on every ordinary save interval. Provider
refreshes retain the ordinary save cadence. Orderly shutdown drains the newest
pending live values; abrupt termination can lose the latest uncheckpointed ticks.
Original source timestamps, stale/partial warnings, privacy exclusions and disk
retention remain unchanged. Settings > Cache and startup reports prepared-page,
additional-data and local-session payload estimates separately. Prepared data is
protected from eviction; the 64 MiB additional-query budget is not a total RAM cap.

MCP status uses the shared dirty-event IPC path. Bridge activity and heartbeat
expiry publish changes, including the 1.5-second activity and 15-second connection
timeouts. The top-bar indicator keeps a 30-second recovery check; older preload
APIs retain their polling fallback. Detailed diagnostics remain in Settings.
The cloud-sync panel also reuses its prepared startup status on first visit;
its existing periodic checks and explicit commands keep the shared snapshot current.

Run from the repository root:

```sh
npm run typecheck
npm run build
npm run probe:quant -- --offline
npm run probe:quant-performance --workspace budget-terminal-desktop
npm run probe:cache
npm run probe:cache-ui
npm run probe:performance-ui --workspace budget-terminal-desktop
npm run probe:workers-build --workspace budget-terminal-desktop
npm run probe:readiness-ui
npm run probe:readiness-ui -- --startup-only
npm run probe:launcher
npm run probe:agent-privacy
npm exec --workspace budget-terminal-desktop -- tsx scripts/probe-efficiency-renderer.ts
npm exec --workspace budget-terminal-desktop -- tsx scripts/probe-efficiency-ui.ts
npm exec --workspace budget-terminal-desktop -- tsx scripts/probe-stock-chart-layout-ui.ts
```

The numerical benchmark compares the previous full-spread prescreen with the
optimized implementation on the same deterministic 40-symbol, 740-observation
histories. It asserts equivalent results and reports three-run medians plus worker
event-loop responsiveness; timings are machine dependent. The UI stress probe
exercises 10,000 variable-height rows. The readiness probe injects 2,000 extra
queries before visiting all pages to verify startup protection under eviction.
Persistence probes use temporary data directories and browser profiles.

The live-update regression checks compare incremental RSI/SMA with full
recalculation (including 5,000-bar retention shifts), route bursts through a cache
with 2,000 unrelated queries, inspect real chart update calls, and exercise live
checkpoints, provider results with unchanged timestamps, restart and close flushes.
MCP checks cover pushed native status, timeout expiry, fallback polling and recovery.
The unrestricted readiness interaction sweep currently fails on the Portfolio
Momentum Tracker subtab with an undefined `length`; its startup-only mode covers
the all-page startup and first-visit requirements independently.
