# Deferred application efficiency work

Status: pending. Run this task when the user has more usage credits and asks to resume it. This file is a task specification, not an automatically scheduled job.

## Future-run instructions and completion

1. Read AGENTS.md, this file, and bugs.md if it still exists. Inspect current code and working-tree changes; preserve unrelated edits. Coordinate shared persistence work with the import-safety fix in bugs.md.
2. Establish repeatable measurements before implementing the opportunities below. Recheck that each still applies; this audit describes the source as reviewed, not measured application-wide bottlenecks. Implement in focused increments, starting with items 1-3. Avoid speculative rewrites.
3. Preserve initial preloading for every implemented page, including hidden and unvisited pages, ready content on navigation, freshness/provenance, explicit refresh, background agents and notifications. Keep startup diagnostics in Settings, global diagnostics banners and the bottom status strip hidden, and the existing palette unchanged.
4. Preserve local-save durability, complete automatic backups, import rollback, cloud conflict detection, privacy, shared provider rate gates, and public tool/API compatibility. Use isolated APPDATA and LOCALAPPDATA for persistence probes; use synthetic data in reports and screenshots.
5. Update the double-click launchers per repository instructions. Run typecheck, focused regression probes and UI smoke checks for visible behavior. Record before/after results and any justified exclusions below.
6. Delete efficiency.md only when every item is implemented and verified, already satisfied, or explicitly assessed and documented as unsuitable with evidence. Summarize that disposition and validation in the final handoff before deleting this task file. If interrupted or blocked, keep the file and update its progress section. Do not delete bugs.md unless that file's own completion requirements are satisfied.

No application optimizations were implemented during this audit. No percentage speedup or memory reduction is claimed.

## Measurement plan

Use consistent synthetic fixtures for cold startup, warm startup, ready-page switching, an idle connected session, a busy agent with a long conversation, a burst of saved edits, and multiple options at the same expiration. Record fixture sizes, cold/warm cache state, provider call counts, IPC counts/bytes, store reads/writes/serialization counts, cache sweeps, task-plan rebuilds, and main/renderer CPU or long-task observations. Compare repeated runs under the same conditions. Do not run live provider benchmarks by default or put personal data into the public repository.

Existing helpers include apps/desktop/scripts/probe-performance-ui.ts, probe-loading.ts, probe-cache.ts, probe-cache-ui.ts, probe-backup.ts, probe-cloud-sync.ts, probe-options.ts, probe-portfolio.ts and probe-agents.ts. Inspect each runner's arguments and isolation before using it; do not assume every probe has an offline mode. Use npm.cmd on Windows if PowerShell blocks npm.ps1.

## 1. Share raw option-chain requests by ticker and expiration

Priority: high. Benefit: fewer provider requests and less rate-gate pressure during startup and option refreshes.

Evidence: apps/desktop/electron/services/yahoo/optionQuotes.ts caches individual marks using ticker, expiry, strike and strategy, but fetchContract downloads the complete chain for each distinct mark. Different strikes at the same expiry therefore use different cache keys for equivalent upstream downloads. options.ts and optionsPage.ts also fetch chains through their own representations; inspect these before designing a shared cache.

Verified isolated fixture: three call positions with one ticker, one expiration and three distinct strikes produced three chain requests plus one expiration-list request. All three rows were priced. The Yahoo method was stubbed and both data-directory environment variables pointed to a temporary directory; no live API was needed.

Implementation direction: introduce a typed raw-chain cache and in-flight coalescing by normalized ticker/expiration, then derive individual marks and page-specific shapes. Keep the shared expiration-list Date[] contract intact. Avoid reusing incompatible existing derived cache payloads under the same key. Preserve force-refresh intent, rate-gate priority, per-row failures, mark timestamps and stale fallback.

Acceptance: the same cold three-position fixture uses one chain request plus the expiration-list request. Concurrent consumers join the shared request; different expirations remain independent. Calls, puts, long and seller strategies return unchanged prices and provenance. A failed shared fetch remains visible on every affected row; a later retry recovers.

## 2. Reuse one captured saved-data snapshot per revision

Priority: high. Benefit: less whole-book cloning, disk reading and serialization on each edit, especially with large article libraries.

Evidence: automaticBackup.ts withAutomaticBackup calls readLocalSyncData and then save/writeSnapshot. cloudSyncData.ts readSyncData exports portfolios/settings/cards and reads all articles; writeSnapshot independently exports/reads those stores again. canonical recursively sorts object keys and builds the entire sync string. readLocalSyncData also hashes the same payload again when persisting changed metadata. CloudSyncEngine.remember reads local state again after a sync. The save queue makes this repeated work part of later edits' wait time.

Implementation direction: capture a complete immutable snapshot once under the existing saved-data lock and reuse it for sync hashing and backup serialization. Reuse the computed hash within that operation. Consider revision-based memoization only with explicit invalidation for all mutation, import, clear, recovery and external-file-change paths. Keep backup-only fields such as lastBackupAt distinct from the canonical sync payload.

Acceptance: instrument store exports/reads and serialization on representative edit bursts. Demonstrate fewer duplicate full-store reads while backup contents and sync payloads remain equivalent. Every acknowledged successful edit remains durably saved and backed up; shutdown flush and crash recovery still work. Do not introduce a debounce that acknowledges an edit before its existing durability guarantees are met, or cache snapshots across untracked external writes.

## 3. Narrow saved-data invalidation to actual dependencies

Priority: high. Benefit: avoid waking unrelated cached market queries and reconstructing expensive analytics after metadata-only edits.

Evidence: src/api/mcpChanges.ts refreshSavedData invalidates all cached returns, momentum, analytics, optionQuotes and cardsPerformance families whenever the portfolio domain changes, using refetchType: all. electron/ipc/serviceHandlers.ts publishes that same domain for portfolio mutations without field-level detail. Renames and watchlist edits can therefore invalidate history and option-mark queries whose inputs did not change. The mutation hooks also update their own query cache and invalidate settings, while file watching supplies another invalidation path.

Implementation direction: measure duplicate refreshes first, then add explicit change details or compare stable input signatures so only affected query families/keys refresh. Coalesce overlapping notifications without losing external edits. Keep a conservative full refresh for import/clear/cloud replacement or unknown changes.

Acceptance: rename a portfolio and edit a Charts watchlist without refetching unchanged historical analytics or option marks. Changing shares/cash/contracts or ticker membership still refreshes all real dependents, including prepared unvisited pages. Verify local UI edits, external/MCP edits and cloud downloads. Do not solve this by refreshing only the active page or removing startup preload.

## 4. Reduce repeated full-status transfers

Priority: medium. Benefit: lower idle CPU, IPC allocation and repeated cloning of long conversations.

Evidence: src/api/agentsQueries.ts useAgents(true), mounted by App.tsx, polls every 700 ms while busy and every 3 seconds for connected/enabled background activity, including when the app is in the background. agents.ts snapshot structured-clones state and workspace data; agentsHost.ts adds Telegram state/history. notificationsQueries.ts requests the complete inbox every 3 seconds in the background. browserQueries.ts polls browser status every 600 ms while active. src/main.tsx also recomputes startup-page diagnostics every second even after startup settles.

Implementation direction: prefer versioned push notifications or compact revision/status responses, with full snapshots for initialization, reconnect and explicit recovery. A lightweight header/navigation subscription can be separate from conversation payloads. Coalesce streaming updates at a measured cadence and derive diagnostics from state changes. Keep bounded recovery polling where necessary and support both desktop and existing bridge transports.

Acceptance: fewer idle calls and bytes with a populated inbox and long conversation; no lost final stream chunks, navigation requests, unread badges, tracker transitions or notification updates. Background agent work and reminder delivery must continue. Demonstrate reconnect recovery and safe listener cleanup. Do not merely slow visible streaming or stop background services.

## 5. Subscribe startup planning only to request inputs

Priority: medium. Benefit: avoid rebuilding the complete all-page task plan for presentation-only state changes.

Evidence: src/api/prefetch.ts subscribes schedule to entire Zustand stores, coalesces for 100 ms, then calls buildTasks for all pages and regenerates task identities. Task identity intentionally excludes layout/drawing state, so the scheduler usually retains its work, but task construction still happens. For example, charts.ts setDrawings, setSplitterRatio and indicator changes notify the same whole-store subscription as ticker/interval changes.

Implementation direction: subscribe to small stable selections of actual planning inputs, or compare those selections before scheduling. Audit task construction and revision keys together so watchlists, company selections, calendar dates and other request inputs remain complete. Keep reconciliation batched for multi-field edits.

Acceptance: editing a drawing or resizing a splitter does not rebuild the all-page plan. Changes to real request inputs still reconcile promptly, and every implemented page is planned at startup. Instrument buildTasks calls and provider calls separately; a plan rebuild does not automatically mean duplicate network requests.

## 6. Avoid cache sweeps for events that cannot affect eviction

Priority: medium. Benefit: reduce repeated full-cache traversal/sorting during status polling and observer churn.

Evidence: src/api/queryMemory.ts schedules a sweep on every query-cache event. sweep then enumerates the cache and sorts candidates. Local/live roots such as agents, notifications, browser and saved records are excluded from eviction inside the sweep, but their events still schedule one. Fetch-state and observer-result events can also schedule work without changing the evictable payload. The implementation already caches byte estimates and yields; preserve those protections.

Implementation direction: classify events/roots before scheduling, and dirty-track changes relevant to size, lifetime or eligibility. Retain periodic idle eviction and correct handling of observer changes, pin ownership, additions/removals and completed fetches. Coordinate with item 4 so frequent state updates do not trigger unnecessary maintenance.

Acceptance: many updates to excluded status queries cause no extra full-cache sweeps, apart from the deliberate periodic sweep. Eligible remote updates still enforce byte/query/idle limits. Active queries and current startup pins remain protected; retired selections can be evicted; replacement during a yielded sweep remains safe.

## Progress and final disposition

- Audit complete; all six items pending implementation and measurement.
- Item 1 request counts were verified with an isolated synthetic fixture. Items 2-6 are source-backed opportunities requiring before/after profiling during the future run.
- Existing user changes and bugs.md must be preserved.
