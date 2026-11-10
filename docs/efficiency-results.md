# Application efficiency fixes

Completed from `efficiency.md` on 2026-11-10. All six opportunities were implemented. The audit task file is retired after verification; these results and the regression probes remain.

## Repeatable measurements

Fixtures use synthetic data and temporary APPDATA/LOCALAPPDATA directories. No live market benchmark or personal library was used. Original renderer policies were loaded read-only from HEAD (`b290c62` when measured) by `probe-efficiency-renderer.ts --baseline`. That optional comparison uses the current HEAD; run it against the original revision to reproduce the old policy after committing these changes. The persistence/provider baseline was recorded before implementation; optimized counts were reproduced across subsequent full runs. The native IPC comparison executes both legacy and current policies in the same Electron fixture.

| Fixture / operation | Before | After |
| --- | ---: | ---: |
| Cold marks: one ticker, one expiration, three strikes — chain requests | 3 | 1 |
| Same cold marks — expiration-list requests | 1 | 1 |
| Same marks, warm cache — additional provider requests | 0 | 0 |
| Five acknowledged cash edits with 200 articles, 1,000 content bytes each — article-file reads | 10 | 5 |
| Same edit burst — strategies-file reads | 10 | 5 |
| Same edit burst — local sync-metadata reads | 5 | 5 |
| Three overlapping metadata-change notifications — saved/market query reads | 21 | 2 |
| Same metadata notifications — historical analytics / option-mark reads | 15 | 0 |
| Five splitter edits separated by 125 ms — all-page plan builds | 5 | 0 |
| 400 excluded status updates in four bursts — extra full-cache sweeps | 4 | 0 |
| Connected idle session, 60 virtual seconds, real hooks and native IPC — full-status reads | 140 | 6 |
| Same idle session — serialized response payload bytes | 6,746,140 | 673,270 |

The idle fixture contains 300 conversation messages with 1,000 text characters each, a 500-item inbox and an active Browser observer. Original calls are Agents 20, Notifications 20 and Browser 100; current calls are two per service. Bytes count UTF-8 JSON response payloads in the IPC handler, excluding transport framing. This fixture advances the actual query timer provider; it does not wait for a real minute or call external services. Initial snapshots are excluded from both counts.

The metadata fixture has cached Portfolio, Settings, Returns, Momentum, Analytics, OptionQuotes and CardsPerformance queries. The current two reads refresh Portfolio and Settings. Unknown changes still refresh every dependent family, including queries without visible observers.

The cache fixture excludes its initial deliberate sweep and runs for less than the retained 30-second periodic-maintenance interval. Its updates do not change an evictable payload. Eligible data still triggers enforcement.

## Implementation and disposition

1. **Raw option chains:** a typed, versioned raw cache normalizes ticker and expiration, shares in-flight work, and feeds portfolio marks, dashboard buckets and the Options page. Derived payloads retain separate namespaces. The shared expiration cache remains `Date[]`. Force intent, the provider rate gate, source timestamps, failures and existing cache fallback behavior remain intact. Probes cover calls, puts, long/seller strategies, concurrent readers, distinct expirations, failed shared fetches and recovery after the existing negative-cache window.

2. **Saved snapshots:** each successful queued edit captures all four stores once, reuses that capture for sync metadata and the complete durable backup, and computes canonical text/hash lazily at most once within that operation. Backup-only `lastBackupAt` remains outside the sync payload. Manual backups do not compute an unused sync hash. There is no cross-operation snapshot cache, save debounce or early acknowledgment. Import validation, journal recovery, rollback and shutdown draining are unchanged and pass their probes.

3. **Saved-data invalidation:** successful rename, reorder and Charts-watchlist mutations carry a verified metadata-only hint. The file watcher suppresses exact echoes of acknowledged local writes and compares previous/current market inputs for external edits. Overlapping renderer notifications coalesce; an unknown change overrides narrower hints. Financial edits, imports, clears and cloud replacements keep conservative dependent refresh. Portfolio metadata is also excluded from startup-plan identities.

4. **Live status:** sources publish compact revision notifications instead of requiring repeated full-status reads. Agent stream notifications coalesce at 700 ms, Browser changes at 600 ms, and notification updates at 100 ms. The next snapshot includes the complete latest state, including final stream chunks. Desktop listeners refresh prepared status queries even while their page is hidden. Recovery reads run every 30 seconds. Transports without the optional subscription retain their previous polling behavior and public read/command APIs. Startup diagnostics subscribe to state changes instead of rebuilding a page summary every idle second. Background workers, trackers and reminders remain independent of renderer subscriptions.

5. **Startup planning:** subscriptions compare only the fields consumed by task construction and task identities. Drawings, indicators, splitter sizing and unrelated Settings edits do not schedule a plan. Real ticker, interval, date, peer and other request changes retain the existing 100 ms reconciliation batch. Every implemented page still participates at startup. Verification also exposed first-visit reads for Settings cloud/provider status; these are now prepared at startup and reused on mount. Explicit configuration edits and cloud status polling still update their caches. Polymarket startup/maintenance requests now retain their scheduler priority rank, keeping background maintenance distinguishable from initial loads.

6. **Memory maintenance:** excluded local/status roots, startup pins and observer-result/fetch-start noise do not schedule full traversals. Eligible additions/removals, observer changes, completed fetches, hydration/state replacements, pin retirement and startup completion still schedule enforcement. Periodic idle eviction, size-estimate caching, yielding, active/pin protection and ownership retirement remain. A payload refreshed during a yielded sweep is protected from that older pass.

## Validation

Use a repository-supported Node runtime. This machine's default Node 22.23.2 is below the repository's security floor; checks/builds used the already available Node 22.23.4 runtime via a command-local PATH override. No machine-wide runtime setting was changed.

Commands run successfully from the repository root, or through the indicated workspace:

```text
npm run typecheck
npm run build:local
npm run probe:efficiency
npm run probe:options -- --offline
npm run probe:launcher
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:backup --workspace budget-terminal-desktop
npm run probe:cloud-sync
npm run probe:cache --workspace budget-terminal-desktop
npm run probe:agents --workspace budget-terminal-desktop
npm run probe:notifications --workspace budget-terminal-desktop
npm run probe:telegram --workspace budget-terminal-desktop
npm run probe:browser --workspace budget-terminal-desktop
npm run probe:performance-ui --workspace budget-terminal-desktop
npm run probe:settings-ui --workspace budget-terminal-desktop
npm run probe:loading-ui --workspace budget-terminal-desktop -- --status-bar-only
npm run probe:readiness-ui -- --startup-only
```

The focused MCP probe (`tsx scripts/probe-mcp.ts` in the desktop workspace) also passes: 94 tools, 46 mutation variants, bridge routing, durable saved edits, backups, query refresh and shutdown drain. Its stale mutation-count expectation was updated to include the existing Charts-watchlist mutation. UI fixtures were updated for the current Settings categories, hidden backup-path disclosure, subscription cleanup and native player teardown.

The UI checks cover every route during startup, empty/populated/restored startup readiness, prepared first visits, Settings failures/diagnostics, native Browser interactions, agent navigation, unread updates, reconnect recovery, and hidden bottom-strip behavior at multiple viewport widths. The existing dark palette and global-banner removal are preserved. Repository double-click launchers and their shared Windows/Linux launch paths reference this completion report.

## Deliberate limits

- No application-wide startup-time, CPU, long-task or resident-memory percentage improvement is claimed. Operation counts establish the targeted reductions; unrelated provider latency and normal GC remain variable. UI smoke tests validate readiness/navigation behavior rather than acting as cross-machine performance benchmarks.
- Long-running cloud sync must still re-read local state after network work: `CloudRecordEngine` uses that read to detect intervening edits. The audited older `CloudSyncEngine.remember` path no longer exists in this working tree. Removing the current check or memoizing across untracked external writes would weaken conflict detection, so it was retained.
- Existing persisted derived option caches keep their own TTLs. Their incompatible shapes were not reused or migrated into the raw cache. A first shared raw fetch occurs when required by a miss or refresh.
- New status consumers retain full initialization and bounded recovery snapshots. This change does not introduce conversation deltas or a second public bridge streaming protocol.
- Unrelated cloud-auth, release configuration and other pre-existing working-tree edits were preserved. `bugs.md` was absent. No production deployment, live provider benchmark or automatic external message was performed.
