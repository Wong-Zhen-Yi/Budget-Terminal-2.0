# Diagnostic logging

Budget Terminal records diagnostic events automatically. Open **Launch Diagnostic Logs.cmd** on Windows (or the matching `.command` / `.sh` launcher on macOS / Linux). While using the main app, **Ctrl+Shift+L** opens the same viewer. The viewer uses software rendering and its own Chromium session/cache profile. Reopening it restores and focuses the existing viewer rather than starting another writer against the same profile. The viewer is a separate Electron process: it can read previous sessions when the application is closed and remains open if the application crashes. It does not load application pages, acquire the application data lock, contact market providers, or connect to Agents.

The diagnostic launcher builds only the viewer and does not clear application bundles. Install dependencies with the normal application launcher first. The keyboard shortcut uses the viewer from the current build. No diagnostics banners or status strips are added to the main app. Existing Settings diagnostics and all-page startup loading are preserved.

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

Files live in `%LOCALAPPDATA%\BudgetTerminal\logs` on Windows. Other platforms use `LOCALAPPDATA` when set, otherwise `~/.budget-terminal/cache`, followed by `BudgetTerminal/logs`. The fallback matches the application data-path setup so the app and viewer agree before and after startup. Application settings, browser profiles and source files are separate. Logs are local and are never uploaded automatically or included in application user-data backups.

Each process writes its own session JSONL files. Files rotate at 4 MiB. On session creation and rotation, old log files are pruned to approximately 64 MiB and 15 days. Multiple simultaneously active writers may temporarily exceed this budget. Debug events and important events (info, warning and error) have separate budgets, each allowing 100 records per second with a 200-record burst. Debug storms cannot consume the reserved completion, failure and page-transition budget. Subsequent records report cumulative drops split into debug and important events. Disk failures do not crash the application; the memory sampler reports storage availability and emits a terminal warning while unavailable. Complete JSONL records are written synchronously, so routine exits do not need an asynchronous flush. Abrupt OS termination can still lose a final record.

Only explicitly selected technical metadata is recorded. Logging excludes request arguments, response data, portfolio and financial values, chat content, browser URLs/content/cookies, raw exception messages and stacks, arbitrary console arguments, file paths, emails, passwords and tokens. Error text is inspected transiently to choose a fixed category, then discarded. The embedded Browser's console and navigation are not captured. Logs can still reveal when you use the application and which pages or operations are active; review exported diagnostics before sharing them.

## Viewer

The viewer reads up to 5,000 recent records from at most approximately 12 MiB per snapshot and polls every two seconds. Search and filter by level, area and session. The table shows up to 500 matching rows; narrow the filters to inspect other loaded records. Select a row for its full JSON record. Pause freezes automatic reads; Refresh still reads immediately. Export saves the **whole loaded snapshot**, including records hidden by filters, through a native save dialog. Open log folder provides access to older retained files. Corrupt or incomplete trailing records are skipped. Read and preload failures show an explicit alert rather than appearing to be an empty log list; the last successfully loaded snapshot remains available until reads recover.

Exporting and viewing have no delete operation. The viewer uses a sandboxed preload with only read, folder and export IPC endpoints; it has no application API. Network connections, navigation and new windows are blocked. Record content is rendered as text.

## Verification

Run `npm run probe:diagnostics`, `npm run probe:diagnostics-ui`, `npm run typecheck` and `npm run probe:launcher`. Both diagnostic probes isolate `APPDATA` and `LOCALAPPDATA` in temporary directories. The UI probe exercises ESM startup, window visibility, software rendering, independent cache paths, repeat-launch restoration and read-failure recovery. It runs the real viewer in Electron with synthetic logs and a temporary export destination; it does not open or modify the user's main application data.
