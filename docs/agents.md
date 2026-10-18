# Agents

Open **Agents** in the sidebar and select **Connect Codex**. This uses the supported [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server) through a private stdio connection in Electron's main process. Dynamic tool calls require the experimental app-server capability.

Install Codex CLI and run `codex login` once if a signed-in installation is unavailable. Windows also detects the desktop Codex binary in `%LOCALAPPDATA%/Programs/OpenAI/Codex/bin`. `BUDGET_TERMINAL_CODEX_PATH` can select an executable on other installations. The selected account's configured model is used initially; no model or API key is hard-coded. Usage follows that account.

The **Model** and **Thinking mode** selectors show the connected Codex runtime's current settings. Options come from its paginated `model/list` catalog, including each model's supported reasoning efforts. Model changes reset thinking to that model's default. Changes apply to subsequent chat and autonomous runs without clearing the conversation, and controls are locked while a run or autonomous schedule is active. Selections survive page changes and reconnects for this app session. A listed model's inference access is confirmed when its run succeeds; access errors appear in the conversation status.

The standard launchers check the detected Codex executable with `--version` and pass its absolute path to Electron. This also handles native Windows executables installed behind npm shims. A missing or broken Codex installation leaves the rest of Budget Terminal usable. Launching the app never connects Codex or enables autonomous mode.

Ask questions such as “Show me the charts for AAPL” or “Summarize my portfolio and flag missing data.” The agent can call the existing validated research services and navigate to implemented pages. Ticker selection works on Charts, Stocks, Fundamentals, Options and Valuation. Hidden pages return an actionable error. Privacy blur remains controlled by the user.

Assistant replies render Markdown as formatted headings, emphasis, lists, tables, quotes and code instead of showing raw formatting markers. User messages preserve their original text. Web links open through the desktop browser bridge; raw HTML and automatic remote images are disabled. The chat uses a centered reading column, user message bubbles and a rounded composer. Select **Controls** to open monitoring and connection help; active monitoring remains visible in the header when controls are closed.

Paste a screenshot into the message box with **Ctrl+V**, choose **Attach image**, or drag images onto the composer. PNG, JPEG and WebP are supported, with up to four images, 8 MB each and 20 MB total per message. Previews can be removed before sending, and an image can be sent without accompanying text. Image bytes travel through the desktop IPC bridge into Codex's image inputs; they are never accepted as arbitrary file paths or external URLs, saved as local image files, or copied into polled chat snapshots. Unsent previews remain in memory across page switches.

To import a portfolio screenshot, ask Codex to update the correct saved account. It reads the existing records and presents a **Review portfolio update** table with saved and proposed values. Select **Apply portfolio update** to save, or **Dismiss update** to discard. Stocks, option positions, brokerage cash and margin debt are supported. Missing fields and positions stay untouched; incomplete new positions require clarification instead of invented cost data. No positions are deleted. Cash and margin use the app's USD ledger. Portfolio changes commit in one atomic store write, reject a preview if that account changed in the meantime, and verify the saved file. They use the app's automatic backup queue; backup failures are reported as saved locally with a backup warning. A saved-data event refreshes the app's portfolio views. Autonomous monitoring cannot propose or approve portfolio updates.

The Agents page exposes the full Budget Terminal MCP catalog as dynamic tools through the same validated service routes used by external MCP clients. No separate MCP installation or configuration is needed inside Agents. Manual chat can read research and settings, capture app screenshots, and make requested changes to saved portfolios, articles, Cards, personal finance and settings. Shared mutation handlers retain automatic backups and saved-data refresh events. Portfolio screenshot imports still use the review-and-apply flow. Autonomous monitoring rejects every mutation tool at dispatch. Screenshot pixels are returned as image inputs alongside page metadata, and captures share a queue with external MCP clients. Connection status is available through `budget_terminal_connection_status`.

Thread creation disables execution environments, shell tools, plugins and configured MCP servers to avoid duplicate Budget Terminal tools and unrelated integrations. Maintenance and shell commands remain outside the MCP catalog. Unsupported server requests are rejected. Provider results retain their source, freshness and errors; failed envelopes are reported as failed tool calls and oversized research results explicitly report truncation.

Autonomous mode is **off on every application launch**. Connect, enter an objective, select a 5–60 minute interval and a 1–12 run limit, then explicitly enable it. The first run begins immediately; later runs begin after the preceding run completes. Monitoring runs in the main process while the window is on another page. It requires the app to remain open and does not run as an OS background service. Failures disable monitoring. Each run is bounded to 10 minutes and 80 tool calls. Stop or turning autonomous mode off cancels the active run, disconnects the agent and cancels scheduled work.

Conversations are held in memory for the current application session and survive page switches. New chat clears this conversation and disconnects. Codex threads are ephemeral; agent snapshots are excluded from persisted renderer caches. The browser companion shows the Agents workspace but connection and agent commands are desktop only.

Startup preloads the Agents snapshot alongside all other implemented pages, without starting Codex or running inference. Global desktop polling handles navigation requests while the Agents page is unmounted. The app acknowledges navigation and returns an error to Codex if it cannot open the requested page.

Validation:

```powershell
npm run typecheck
npm run probe:agents --workspace budget-terminal-desktop
npm run probe:agents --workspace budget-terminal-desktop -- --live
npm run probe:agents-ui --workspace budget-terminal-desktop
npm run probe:agents --workspace budget-terminal-desktop -- --live --live-image
npm run probe:navigation --workspace budget-terminal-desktop
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:readiness-ui --workspace budget-terminal-desktop -- --agents
npm run build
```

The live probe uses one signed-in Codex conversation to test actual dynamic tool calls without requesting live financial data. UI and service probes use fixtures and temporary data directories.
