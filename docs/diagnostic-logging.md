# Diagnostic logging

Budget Terminal records diagnostic events automatically. Open **Settings → Diagnostics** to search and inspect application logs alongside startup and data health information. **Ctrl+Shift+L** opens this section. Diagnostics no longer uses a separate application or profile.

All implemented pages still preload at startup. Diagnostics adds no global banners or bottom status strip. Retained log files remain available across application restarts.

## Events

- Session start, runtime versions, platform, shutdown requests and completion, and startup failures with fixed stage names.
- Valuation stage timings and classified failures, plus whether a snapshot attempted a reload or reused cached warnings. No ticker symbols, payloads or raw failure messages are logged.
- Service request IDs, operation names, start/completion/failure, elapsed time, freshness, error counts and failure categories. Starts without completions help locate interrupted work; requests still running after 30 seconds emit a warning.
- Tracked provider request durations and classified failures, plus Yahoo queue depth, rate and cooldown samples.
- Startup page state transitions, including failure and recovery. States are sampled once per second; transient intermediate states may be coalesced.
- Main-process warning/error console activity, uncaught exceptions, renderer warning/error activity, unhandled renderer errors/rejections, preload/load failures, renderer crashes, unresponsive/responsive events and child-process exits.
- Main-process memory every minute and main event-loop delays over two seconds. Sleep or debugger pauses can also produce delay warnings.

Service IDs are unique within a process session. Tracked provider records carry the parent service `requestId` when available, so parallel request chains can be followed without retaining their payloads. Filter by session to avoid confusing old failures with current ones. Provider records cover calls using the shared API usage tracker; they are not a packet capture. Progress polling is excluded to reduce noise. Raw console messages are replaced with error categories, so an `unknown` category may require further investigation. Logging observes errors without swallowing them or changing service results.

## Storage and privacy

Files live in `%LOCALAPPDATA%\BudgetTerminal\logs` on Windows. Other platforms use `LOCALAPPDATA` when set, otherwise `~/.budget-terminal/cache`, followed by `BudgetTerminal/logs`. The fallback matches the application data-path setup. Application settings, browser profiles and source files are separate. Logs are local and are never uploaded automatically or included in application user-data backups.

Each process writes its own session JSONL files. Files rotate at 4 MiB. On session creation and rotation, old log files are pruned to approximately 64 MiB and 15 days. Multiple simultaneously active writers may temporarily exceed this budget. Debug events and important events (info, warning and error) have separate budgets, each allowing 100 records per second with a 200-record burst. Debug storms cannot consume the reserved completion, failure and page-transition budget. Subsequent records report cumulative drops split into debug and important events. Disk failures do not crash the application; the memory sampler reports storage availability and emits a terminal warning while unavailable. Complete JSONL records are written synchronously, so routine exits do not need an asynchronous flush. Abrupt OS termination can still lose a final record.

Only explicitly selected technical metadata is recorded. Logging excludes request arguments, response data, portfolio and financial values, chat content, browser URLs/content/cookies, raw exception messages and stacks, arbitrary console arguments, file paths, emails, passwords and tokens. Error text is inspected transiently to choose a fixed category, then discarded. The embedded Browser's console and navigation are not captured. Logs can still reveal when you use the application and which pages or operations are active; review exported diagnostics before sharing them.

## Viewer

The viewer reads up to 5,000 recent records from at most approximately 12 MiB per snapshot and polls every two seconds. Search and filter by level, area and session. The table shows up to 500 matching rows; narrow the filters to inspect other loaded records. Select a row for its full JSON record. Pause freezes automatic reads; Refresh still reads immediately. Export saves the **whole retained snapshot**, including records hidden by filters, through a native save dialog. Export reads the latest snapshot even while paused. Open log folder provides access to older retained files. Corrupt or incomplete trailing records are skipped. Read and preload failures show an explicit alert rather than appearing to be an empty log list; the last successfully loaded snapshot remains available until reads recover.

Exporting and viewing have no delete operation. The application renderer accesses logs through validated main-window IPC behind `window.api`. Record content is rendered as text. Polling runs while the log panel is visible and stops when paused or another Settings category is selected.

## Verification

Run `npm run probe:diagnostics`, `npm run probe:diagnostics-ui`, `npm run typecheck` and `npm run probe:launcher`. Diagnostic probes isolate `APPDATA` and `LOCALAPPDATA` in temporary directories. The UI probe renders the Settings log panel with real IPC and synthetic logs, checking filters, text safety, inspection, pause/refresh, export, failure recovery and narrow layout.
