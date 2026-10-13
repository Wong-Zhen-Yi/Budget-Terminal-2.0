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
folder. Install either the local plugin or the direct MCP registration to avoid
duplicate tools. The plugin uses Node from PATH; direct registration can use an
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
