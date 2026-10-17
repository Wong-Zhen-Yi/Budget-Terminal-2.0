# Agents

Open **Agents** in the sidebar and select **Connect Codex**. This uses the supported [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server) through a private stdio connection in Electron's main process. Dynamic tool calls require the experimental app-server capability.

Install Codex CLI and run `codex login` once if a signed-in installation is unavailable. Windows also detects the desktop Codex binary in `%LOCALAPPDATA%/Programs/OpenAI/Codex/bin`. `BUDGET_TERMINAL_CODEX_PATH` can select an executable on other installations. The selected account's default model is used; no model or API key is hard-coded. Usage follows that account.

The standard launchers check the detected Codex executable with `--version` and pass its absolute path to Electron. This also handles native Windows executables installed behind npm shims. A missing or broken Codex installation leaves the rest of Budget Terminal usable. Launching the app never connects Codex or enables autonomous mode.

Ask questions such as “Show me the charts for AAPL” or “Summarize my portfolio and flag missing data.” The agent can call the existing validated research services and navigate to implemented pages. Ticker selection works on Charts, Stocks, Fundamentals, Options and Valuation. Hidden pages return an actionable error. Privacy blur remains controlled by the user.

The embedded agent has read-only data access. Its catalog excludes mutations, settings, file exports, maintenance and shell commands. Thread creation disables execution environments, shell tools, plugins and configured MCP servers. Unsupported server requests are rejected. Provider results retain their source, freshness and errors; oversized results explicitly report truncation.

Autonomous mode is **off on every application launch**. Connect, enter an objective, select a 5–60 minute interval and a 1–12 run limit, then explicitly enable it. The first run begins immediately; later runs begin after the preceding run completes. Monitoring runs in the main process while the window is on another page. It requires the app to remain open and does not run as an OS background service. Failures disable monitoring. Each run is bounded to 10 minutes and 80 tool calls. Stop or turning autonomous mode off cancels the active run, disconnects the agent and cancels scheduled work.

Conversations are held in memory for the current application session and survive page switches. New chat clears this conversation and disconnects. Codex threads are ephemeral; agent snapshots are excluded from persisted renderer caches. The browser companion shows the Agents workspace but connection and agent commands are desktop only.

Startup preloads the Agents snapshot alongside all other implemented pages, without starting Codex or running inference. Global desktop polling handles navigation requests while the Agents page is unmounted. The app acknowledges navigation and returns an error to Codex if it cannot open the requested page.

Validation:

```powershell
npm run typecheck
npm run probe:agents --workspace budget-terminal-desktop
npm run probe:agents --workspace budget-terminal-desktop -- --live
npm run probe:agents-ui --workspace budget-terminal-desktop
npm run probe:navigation --workspace budget-terminal-desktop
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:readiness-ui --workspace budget-terminal-desktop -- --agents
npm run build
```

The live probe uses one signed-in Codex conversation to test actual dynamic tool calls without requesting live financial data. UI and service probes use fixtures and temporary data directories.
