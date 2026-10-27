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
npm run probe:launcher
npm run probe:agent-privacy
```

The numerical benchmark compares the previous full-spread prescreen with the
optimized implementation on the same deterministic 40-symbol, 740-observation
histories. It asserts equivalent results and reports three-run medians plus worker
event-loop responsiveness; timings are machine dependent. The UI stress probe
exercises 10,000 variable-height rows. The readiness probe injects 2,000 extra
queries before visiting all pages to verify startup protection under eviction.
Persistence probes use temporary data directories and browser profiles.
