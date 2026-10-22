# Local MCP for ChatGPT and Codex

[Back to the README](../README.md)

Budget Terminal exposes MCP tools for service operations, page screenshots,
and connection status. Research tools use the same caches and provider rate gate as the app.
Write tools edit saved portfolios, options records, Cards, personal finance and
settings through the existing stores and automatic backup. These are local record
edits, not broker orders. Bulk import/export, clear-all, cache reset and shell
operations remain in the desktop UI.

The bridge starts automatically when Budget Terminal opens. Settings > Data >
Local MCP reports readiness or startup failures. MCP discovery works while the
app is closed; service calls then say to open Budget Terminal. Restarting the app
rotates its session token and port; existing MCP clients recover on their next
call. Do not retry a write after a timeout or interrupted response until you have
read the saved record to check whether it completed.

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
A session retains up to 500 write receipts; it refuses new IDs at capacity rather
than evicting IDs and risking duplicate edits.

**Receipts are in-memory and do not survive app restart.** They are not an
exactly-once guarantee across sessions. After restart, always read saved records
before retrying an interrupted write, even if you still have its request ID. Read
tools do not accept `requestId`. Source, freshness and partial-data errors remain
part of tool output.


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
in Codex or other MCP clients, then run `Launch Budget Terminal.cmd` again. The
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
