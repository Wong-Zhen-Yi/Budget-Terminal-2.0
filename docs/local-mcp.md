# Local MCP for ChatGPT and Codex

[Back to the README](../README.md)

Cloud sync now uses Convex Auth v2. Sign-in, sign-out, session rotation, provider
credentials and sync conflict choices remain desktop-only. MCP cannot access auth
tokens, change the cloud account or bypass local read/write permissions. Existing
MCP writes still save through local stores; optional sync observes those saved-data
changes. No tools or permissions are added for authentication. See
[Convex setup and account reconnection](convex-sync.md).

Workspace ownership approval, public GitHub account display, keyring recovery and
other-device sign-out are also desktop-only. Switching cloud accounts pauses sync
until the user chooses an import or restore in Settings. MCP cannot approve that
choice, inspect account profiles, or revoke sessions; existing tools, schemas and
permissions are unchanged.

OAuth request budgets, single-use session-management grants, abandoned-session
revocation and credential-file cleanup also remain desktop-only. Raw grants and
credentials never reach the renderer, MCP, screenshots or diagnostics.
Existing MCP writes still respect the workspace ownership gate before cloud sync.

Cloud snapshots now share strict nested validation between the desktop and Convex,
with per-account upload allowances and separate authenticated security-action
capacity. MCP edits still save locally even when an upload is invalid or throttled;
cloud retry messages stay in Settings. This adds no MCP tools, schemas, account
access or permissions. The shared launcher still regenerates the MCP bundle.

The desktop account popup restores saved sign-in before opening. Its **Don’t show
again** preference stays on the device and can be reset in Settings. This changes
no MCP tools, authentication access or permission checks.

Budget Terminal exposes MCP tools for service operations, page screenshots,
and connection status. Research tools use the same caches and provider rate gate as the app.
When Finnhub is configured, saved portfolio stock tickers take priority for REST
refreshes and live subscriptions, including pre-market trades when supplied.
Background page and MCP requests share the remaining capacity; a requested ticker
does not gain portfolio priority unless it is saved in a portfolio. Portfolios that
fit within the 50-symbol stream limit stay subscribed while spare slots rotate;
larger portfolios rotate before background stocks. The shared 60-request/minute
REST budget and provider cooldowns remain enforced. See [Finnhub streaming](finnhub-streaming.md).
Write tools edit saved portfolios, options records, Cards, personal finance and
settings through the existing stores and automatic backup. These are local record
edits, not broker orders. Bulk import/export, clear-all, cache reset and shell
operations remain in the desktop UI.
Portfolio **Export for LLM** and **Export Tickers** copy text directly to the
native clipboard on Windows, macOS and Linux. Clipboard access remains a UI-only
operation; these actions do not add MCP tools or file-save dialogs.

Homebuilders is available in Focus and preloads at startup. The read-only
`budget_terminal_homebuilders` tool accepts `{ "request": {} }` (or
`{ "request": { "force": true } }`) and returns ten selected public builders
plus ITB/XHB housing ETF benchmarks. Builder rows include quotes, adjusted-close
histories, P/E, price-to-book, ROE, revenue, consolidated TTM gross margin,
earnings estimates and company news. ETF corporate profiles are intentionally
omitted, and ETFs are excluded from builder breadth and market-cap totals.
Missing values remain null; each market/profile/news lane retains timestamps,
partial failures and stale-cache status. The existing market-research permission
covers this route; no private records or new write permissions are added.
The desktop page has its own housing-specific design: a mortgage affordability
scenario, a price/book versus ROE capital map, a builder ticker strip, and
separate stock-return and reporting views. Mortgage inputs are illustrative,
not fetched rates or company forecasts. The calculator holds P&I and the
down-payment percentage constant for its buying-power scenario and excludes
ownership costs. It is a desktop-only calculation; the research tool contract
and permissions are unchanged by this layout.
Use `request.page: "homebuilders"` for screenshots. Run `npm run build:mcp`
and reconnect MCP clients after this catalog change.

Scorecard compares 3–6 companies in a company-column matrix with selectable
metrics and Chart, Method and Sources views. It continues to use the shared
`fundamentalsPage` service and caches; MCP research clients can use
`budget_terminal_fundamentals_page` for each company. Named Scorecard views and
matrix sorting remain desktop preferences. This layout adds no service routes,
permissions or MCP schemas. Page screenshots continue to use the `scorecard` key.

News reads (`news`, `newsPage`, `newsTickerSearch`, `newsArticle`, `forexNews`)
always request a source refresh before returning, including when `request.force`
is omitted or false. This applies to external clients and embedded manual,
autonomous and tracker agents. Refreshes keep the shared provider rate gate and
source failure warnings; stale fallback evidence is never verified current news.
Check each article's publication date separately from the retrieval timestamp,
cite its link and say when no recent stories were found. Publication dates remain
in response provenance when fields are projected out. Regular page reads keep
their existing caches and startup preloading behavior.

Portfolio headlines (`news`, `newsTickerSearch`, and the portfolio lane of
`newsPage`) use [TickerTick](https://github.com/hczhu/TickerTick-API) first, with
Yahoo search for unsupported symbols, empty ticker coverage, or request failures.
The market lane also includes TickerTick's `T:market` feed alongside the existing
RSS feeds; Yahoo continues to supply macro/index/futures headlines. TickerTick is
keyless and runs only in the main process. Up to 25 US symbols share each OR query,
and identical concurrent reads share the same cached request. All TickerTick
requests share one gate enforcing at most five requests per 30 seconds and ten per
minute, including forced MCP refreshes. Busy budgets and HTTP 429 cooldowns use
fallback coverage with explicit errors, rather than silently calling cached news
current. Failed market refreshes may retain a labelled snapshot for at most a day.
Publisher URLs, summaries, millisecond publication dates and string story IDs are
preserved; publisher favicons are not presented as article photos. The existing
tool routes, input/output contracts and permissions are unchanged. Rebuild with
`npm run build:mcp` and reconnect MCP clients to load the updated descriptions.

Options reads (`options`, `optionsChain`, `optionsExpirations`, `optionQuotes`)
also force a refresh when `force` is omitted or false. For highest-volume contracts
across a ticker's live expirations, call `budget_terminal_options_expirations`
with `request: { "symbol": "AAPL" }` and
`response: { "mode": "full", "fields": ["symbol", "marketDate", "topVolume", "generatedAt"] }`.
`topVolume.rows` contains up to 50 positive-volume contracts ranked across every
successfully loaded expiration by volume, with open interest breaking ties. It
includes prices, bid/ask, open interest and last-trade dates where supplied.
The accompanying counts and `failedExpirations` describe coverage; envelope errors
remain visible. Ranking precedes projection, so large raw chains can be omitted
without losing the actual leaders. Generic summary mode samples rows and should
not be used to establish the ranking. Results cover the requested ticker, not a
market-wide universe. A fresh request does not guarantee live exchange data or
recent option trades. Ordinary page caching and startup loading are unchanged.

The bridge starts automatically when Budget Terminal opens. Settings > Data >
Local MCP reports readiness or startup failures. MCP discovery works while the
app is closed; service calls then say to open Budget Terminal. Restarting the app
rotates its session token and port; existing MCP clients recover on their next
call. Do not retry a write after a timeout or interrupted response until you have
read the saved record to check whether it completed.

Cache status, cache configuration and heatmap loading progress remain desktop-only
services. They are explicitly excluded from the MCP route registry so adding these
local controls does not prevent MCP or the Agents workspace from starting.

## Permissions, approval and diagnostics

MCP defaults to **read-only**, including upgrades without a saved MCP policy.
Settings > Data > Local MCP lets you disable read-only and choose whether every
saved-record edit requires local approval (on by default). Read-only also blocks
Browser research actions because they change the shared interactive browser session;
ordinary research APIs and browser status inspection remain available. These rules
are enforced for both external clients and embedded agent catalog tools. Autonomous
agents retain their additional read-only restrictions. Manual UI edits and the
existing user-reviewed portfolio-import flow are unchanged.

Approvals use a native desktop dialog showing the exact requested edit, default to
Deny, and expire after 60 seconds. An edit too large to display safely is refused,
not silently truncated. Only one approval can be pending; other edits are refused.
Changing permissions, stopping an embedded agent, disconnecting the bridge request,
or closing the app cancels pending approval. An edit already executing may still
complete; a cancelled request is not a rollback. Denied/expired IDs cannot be
reused to force another attempt; inspect records and make a new user-requested edit.

Permissions are stored locally in the restricted `.mcp/access.json` file, separately
from agent-editable settings and exported backups. Agents cannot change their own
MCP permissions. An unreadable or invalid policy falls back to read-only with a
visible warning. Saving a policy must succeed before it takes effect.

The panel includes an authenticated connection test and the last 100 calls for the
current session: tool name, caller category, time, duration and outcome. Active calls
and pending approvals remain visible. Arguments, results, URLs, client-supplied IDs
and error details are never included in this activity log. Heartbeats are excluded.
The log is not persisted or exported. Caller categories distinguish external tools
from embedded tools; they do not identify individual external clients.

## Safe saved-record retries

Every mutation now requires a `requestId` alongside `request`. Reload your client's
MCP connection after rebuilding so it discovers the updated input schemas. Use a
fresh UUID for each intended edit and reuse it only for an exact retry:

```json
{
  "requestId": "example-time-format-edit-001",
  "expectedRevision": "<meta.revision from budget_terminal_settings>",
  "request": { "type": "setTime12h", "value": false }
}
```

Read `budget_terminal_settings` first and replace the example revision placeholder
with its actual 64-character `meta.revision`. For `budget_terminal_mutate_settings`,
this records one intended edit. Concurrent
or later calls using the same tool, ID and arguments share/replay the original
outcome without another edit or approval. Reusing an ID with different arguments
is refused. Failed or uncertain attempts are not automatically executed again.
Large results replay a small receipt instructing the client to read saved records.
The private journal retains up to 500 write receipts across restarts; it refuses new IDs at capacity rather than evicting IDs and risking duplicate edits.

**A private write journal survives app restart.** It records only hashed tool/request IDs, argument fingerprints, outcome states and timestamps in the restricted `.mcp/write-journal.json` file. Arguments, financial records, article content and provider errors are never stored there. Before execution the journal durably records an uncertain outcome; completion updates it atomically. A crash between saving the record and updating the journal remains uncertain, so this is not an exactly-once guarantee.

After interruption, call `budget_terminal_operation_status` with `request: { "tool": "budget_terminal_mutate_settings", "requestId": "original-id" }`, then read the saved records. States are completed, failed, refused, uncertain or unknown. An existing ID never executes again after restart; its small receipt instructs the caller to read records. Unknown does not prove an edit never happened. An unreadable journal blocks writes and reports its failure in Settings. At capacity, inspect records, disconnect clients and close the app before archiving the private journal locally; archived IDs no longer provide deduplication protection. The journal is excluded from backups and exports. Read tools do not accept a top-level `requestId`.


## Concurrent edit protection

Portfolio, Cards, personal-finance and settings mutations require `expectedRevision`
outside `request`, alongside `requestId`. Read the corresponding domain first and
copy its `meta.revision`. Stores compare this token inside their write queue before
applying changes, including changes made in the UI while approval was pending. A
stale revision returns a failed envelope without editing or updating the backup.
Re-read and review the intended edit before submitting a new ID and revision.
Article edits continue to use their per-article revision numbers. Incidental paths
and backup timestamps do not invalidate saved-record revisions. These checks apply
to MCP edits; manual editing retains the existing UI contract.

## Research response controls

Ordinary read tools accept an optional `response` object outside `request`:

```json
{
  "request": { "latestOnly": true },
  "response": {
    "collection": "rows",
    "fields": ["ticker", "rank", "composite"],
    "offset": 0,
    "limit": 25,
    "maxBytes": 65536
  }
}
```

This example reads a saved Quant scan. Inspect the result schema before choosing
collection/fields: `collection` is a dot path inside `data`; `fields` are top-level
row fields (or fields of `data` when no collection is selected). Pagination reports
total, offset, limit and nextOffset under `response.page`. It slices returned data,
so it does not reduce provider work. An invalid collection is rejected.

`response.mode: "summary"` samples up to three entries per array and shortens long
text; it is a deterministic preview, not an analytical conclusion. Omission/sampling
flags always accompany shaped results. The JSON data budget defaults to 256 KiB,
configurable from 4 KiB to 1 MiB. Oversized data is replaced with an explicit omission
notice; request smaller pages or fields. Envelope metadata and errors remain intact.
Selected-away source/timestamp/coverage details are retained separately in provenance,
bounded to 100 entries/32 KiB with an explicit provenanceOmitted flag. Large results
are carried once in structuredContent with a compact text notice. Native screenshot
images keep their existing MCP image blocks and are outside this JSON data budget.

## Progress, cancellation and setup

Clients that request MCP progress receive numeric completion updates for Quant and
technical scans and multi-page screenshots. The adapter streams progress from Electron
and forwards MCP cancellation to the bridge. Settings also exposes Cancel request for
active calls. Scan cancellation stops new history work; shared cached/provider reads
already in flight may finish. Capture cancellation restores the selected page,
background throttling and IPC handler. Other shared reads may finish cache work before
cancellation settles. The bridge transport allows up to ten minutes for tool work and
uses a five-second connection-test timeout. Client-side deadlines can be shorter.
An executing edit is allowed to finish: cancellation never means rollback. Inspect
records and use the same-session receipt before considering another write.

Settings > Data > Local MCP includes copyable stdio client JSON and a connection test.
The test verifies the data folder is readable/writable and outside source/Git folders,
then authenticates against the running bridge. Configuration points to the built Node
adapter and selects the local data folder. The adapter reads the runtime descriptor on
every call; no session token or session port is copied into client configuration.
Node.js must be on the client's PATH. Reconnect clients after rebuilding to refresh schemas.

The optional **Ask before agents read or capture website content** switch applies to
website text, link extraction, browser screenshots and website pixels in app screenshots.
It defaults off for compatibility with the existing Browser access switch. Each content
action requests a native Allow once/Deny decision, defaults to Deny and expires after
60 seconds. Stop, disabling access, policy changes, cancellation and page changes
invalidate pending consent. Manual browser reading stays available. Signed-in content
is only exposed after the applicable access controls and approval succeed.

Build and verify from the repository root:

```bash
npm run build
npm run probe:mcp
```

The standalone entrypoint is `apps/desktop/out/mcp/server.mjs`. Use the supported
Node.js versions listed in the [quick start](../README.md#quick-start). Register it with the installed
Codex CLI using absolute paths (quote each path separately):

```text
codex mcp add budget-terminal --env BUDGET_TERMINAL_DATA_DIR=<absolute-data-folder> -- <absolute-node-executable> <absolute-repository>/apps/desktop/out/mcp/server.mjs
```

Use the full data folder: on Windows this is normally
`%APPDATA%\BudgetTerminalElectron`; macOS/Linux normally use
`~/.budget-terminal/data/BudgetTerminalElectron`. If the app uses an `APPDATA`
override, point the MCP adapter to that same app data folder. Do not put a session
token in client configuration. Do not register an npm command: npm's banners can
corrupt stdio protocol output. `npm run --silent mcp` is available for manual
process startup; configured clients should run Node directly.

For heavy research screens, set `startup_timeout_sec = 15` and
`tool_timeout_sec = 180` inside the server's `[mcp_servers.budget-terminal]`
table in the client's `config.toml`. These values are configured on this machine.

Supported ChatGPT/Codex desktop clients and Codex CLI can share the same local
host configuration. Restart or reload the client's MCP connection after initial
registration. Alternatively, add a STDIO server in desktop Settings > MCP servers
with the same Node command, entrypoint argument, and data-directory environment
variable. Local execution is required; this package alone does not provide a
cloud/web endpoint. See the [official MCP configuration guide](https://learn.chatgpt.com/docs/extend/mcp).

`codex mcp get budget-terminal` and `codex mcp list` inspect registration.
`codex mcp remove budget-terminal` removes it without deleting app data.
Call `budget_terminal_connection_status` first when diagnosing availability.
Tools accept a `request` object; reads with no parameters use
`{ "request": {} }`. The connection-status tool uses `{}` directly. For example:

```json
{ "request": { "symbol": "AAPL" } }
```

Use that input with `budget_terminal_stocks`; sources, timestamps, freshness and
partial-data errors are preserved in structured output and JSON text.

Use `budget_terminal_screenshot` with `{ "request": {} }` to capture the current
page, `{ "request": { "page": "charts" } }` for a specific tab id, or
`{ "request": { "page": "all" } }` for every implemented page, including hidden
tabs. Results contain PNG image blocks with page ids, dimensions, capture times,
privacy and startup-loading status, and the visible footer status. Captures show
the current viewport, including any loading or error state; they do not wait for
provider fetches. Electron captures its rendered content even when the window is
covered, hidden or minimized, without bringing it forward. The selected tab and
background throttling are restored afterward. Screenshots preserve privacy blur.

`npm run build:mcp` also prepares a self-contained local plugin under
`plugins/budget-terminal`, including its generated `server/server.mjs` bundle.
Generated bundles are excluded from Git; rebuild before copying or packaging that
folder. Builds leave identical bundles untouched and publish changed bundles by
atomic replacement, retrying temporary Windows file locks for about 10 seconds.
If a bundle stays locked, close Budget Terminal and disconnect its MCP connection
in Codex or other MCP clients, then run `npm run build:mcp` again. The
build does not forcibly stop clients or silently fall back to an outdated bundle.
Install either the local plugin or the direct MCP registration to avoid duplicate
tools. The plugin uses Node from PATH; direct registration can use an
absolute executable path. No account upload or public publication is required.

The Electron bridge listens only on IPv4 loopback and requires a random per-session
bearer token. Its runtime descriptor lives in a restricted `.mcp` directory beside
the saved data (owner-only permissions on Unix; current-user ACL on Windows).
Browser-origin requests, invalid schemas, unknown routes and bodies larger than
2 MiB are rejected. Logs do not include tokens or saved records.

Additional verification: `npm run probe:security --workspace budget-terminal-desktop`
checks real Electron IPC and mutation events; `npm run probe:loading-ui --workspace budget-terminal-desktop`
checks the status panel, all-page startup navigation, and PNG capture of all pages
with hidden, minimized and covered windows. The MCP probe uses only
temporary data/cache/backup folders and deterministic provider substitutes for
research routing. Live feed availability is not asserted by those offline probes.

## Research workflows and output contracts

Every tool advertises an output schema. Full results describe the shared service types; response-shaped results, failed envelopes, native image metadata and structured errors have explicit variants. Rebuild and reconnect clients to refresh both input and output schemas.

Start common research with:
- `budget_terminal_company_overview`: `request: { "symbol": "AAPL" }` coordinates current quotes, fundamentals and refreshed news.
- `budget_terminal_portfolio_briefing`: `request: { "portfolioId": "saved-id" }` reads that portfolio and fetches quotes and news only for its symbols.

Use optional `sections` to avoid unnecessary provider work: company sections are quotes, fundamentals and news; portfolio sections are quotes and news. An omitted section never starts a provider call. Evidence retains each section's envelope, source timestamps and coverage warnings. Stale or failed sections make the briefing partial. Portfolio briefings do not return other portfolios. Existing individual tools remain available.

## Stable paging, filters and ranking

Add `response: { "collection": "items", "snapshot": "new", "limit": 25 }` to a read to retain a stable snapshot. Reuse the returned top-level `snapshotId` as `response.snapshot` with the same tool and request for later offsets. Subsequent pages reuse the captured result without calling providers, including news/options refreshes. Treat timestamps as the snapshot's observation times, not a new live refresh. Snapshots last five minutes, hold at most eight results and 16 MiB total, and reject individual results above 4 MiB. They are private, session-only, cleared on policy changes and may be evicted; an expired ID produces an explicit error rather than silently fetching different rows.

`response.filter` matches top-level row fields by exact scalar equality. `sortBy` and `descending` sort before pagination, with nulls last. Unknown fields are rejected; valid optional fields may be absent in a provider result. Summary mode still samples rows and must not be used for analytical rankings.

Initial filtering and pagination shape service results after retrieval and do not reduce provider work. Narrow existing request symbols/dates or workflow sections first. Stable subsequent pages avoid repeat fetches.

## Category permissions and structured errors

Settings > Local MCP independently controls market research, portfolio/Card reads, personal-finance reads, saved articles/settings, screenshots, browser content/actions and record edits. Omitted category values retain existing access for compatibility; read-only remains the default and still blocks edits and browser actions. Workflows enforce permissions for their child tools. Screenshots require all private read categories and browser access to prevent visual disclosure of denied data. Revoking access also invalidates snapshots; a read finishing after category revocation cannot return its result.

Errors return `structuredContent.error` with `code`, `message`, `retryable` and `nextStep`, plus the same details in text and `isError: true`. Codes include APP_CLOSED, INVALID_ARGUMENTS, UNKNOWN_TOOL, STALE_REVISION, APPROVAL_DENIED, ACCESS_DENIED, RATE_LIMITED, CANCELLED, CONNECTION_INTERRUPTED, JOURNAL_UNAVAILABLE and SERVICE_FAILED. Retry guidance never authorizes repeating an uncertain write. Provider failed/partial envelopes keep their original source errors.

`npm run probe:mcp` includes deterministic workflow scenarios covering selective calls, retained news dates and source warnings, snapshot reuse, category enforcement for both callers, journal recovery and stale UI revisions. These verify the tool workflows; they do not benchmark a language model's tool-selection accuracy or live provider latency.
