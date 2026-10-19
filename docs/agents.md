# Agents

Codex connects automatically when the desktop app starts, even if Agents is not the active page. Open **Agents** in the sidebar to chat. If startup connection fails, the error stays visible; fix the installation or sign-in and select **Connect Codex** to retry. This uses the supported [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server) through a private stdio connection in Electron's main process. Dynamic tool calls require the experimental app-server capability.

Install Codex CLI and run `codex login` once if a signed-in installation is unavailable. Windows also detects the desktop Codex binary in `%LOCALAPPDATA%/Programs/OpenAI/Codex/bin`. `BUDGET_TERMINAL_CODEX_PATH` can select an executable on other installations. The selected account's configured model is used initially; no model or API key is hard-coded. Usage follows that account.

The **Model** and **Thinking mode** selectors show the connected Codex runtime's current settings. Options come from its paginated `model/list` catalog, including each model's supported reasoning efforts. Model changes reset thinking to that model's default. Changes apply to subsequent chat and autonomous runs without clearing the conversation, and controls are locked while a run or autonomous schedule is active. Selections survive page changes and reconnects for this app session. A listed model's inference access is confirmed when its run succeeds; access errors appear in the conversation status.

The standard launchers check the detected Codex executable with `--version` and pass its absolute path to Electron. This also handles native Windows executables installed behind npm shims. A missing or broken Codex installation leaves the rest of Budget Terminal usable. Launching the app connects the installed, signed-in Codex runtime but never sends a message, runs inference or enables autonomous mode. A failed connection does not block other pages.

The two clickable quick prompts are **Summarize portfolio news** and **Brief me on my portfolio for the day**, on both Agents and Dashboard 2. Clicking one fills the composer so you can review or edit it before sending.

Ask questions such as “Show me the charts for AAPL” or “Summarize my portfolio and flag missing data.” The agent can call the existing validated research services and navigate to implemented pages. Ticker selection works on Charts, Stocks, Fundamentals, Options and Valuation. Hidden pages return an actionable error. Privacy blur remains controlled by the user.

Assistant replies render Markdown as formatted headings, emphasis, lists, tables, quotes and code instead of showing raw formatting markers. User messages preserve their original text. Web links open through the desktop browser bridge; raw HTML and automatic remote images are disabled. The chat uses a centered reading column, user message bubbles and a rounded composer. Select **Controls** to open monitoring and connection help; active monitoring remains visible in the header when controls are closed.

Ask “Show my portfolio allocation as a pie chart” to render a native chart directly in the reply, both on Agents and in Dashboard 2's Agents pane. Charts include a color legend, values, calculated percentages, total, and optional source/freshness caption. Hover a slice for its value and share; the accompanying table also makes every category readable without relying on color. No external image service or chart generation runtime is used.

The agent emits a fenced `pie` block containing JSON, which the app validates before rendering:

````markdown
```pie
{"title":"Portfolio allocation","unit":"USD","slices":[{"label":"Stocks","value":750},{"label":"Cash","value":250}],"caption":"Example only, not live portfolio data."}
```
````

Use 1–30 labelled slices, nonnegative finite values in one unit, and a positive total. Zero-value categories remain in the table but have no wedge. Negative values, unknown fields, oversized payloads, malformed JSON and invalid totals show a readable fallback with expandable raw data instead of crashing the response. Pie data is display-only, is retained with its saved conversation, and never updates saved portfolios. Raw HTML, model-supplied styles and remote images remain disabled.

Paste a screenshot into the message box with **Ctrl+V**, choose **Attach image**, or drag images onto the composer. PNG, JPEG and WebP are supported, with up to four images, 8 MB each and 20 MB total per message. Previews can be removed before sending, and an image can be sent without accompanying text. Image bytes travel through the desktop IPC bridge into Codex's image inputs; they are never accepted as arbitrary file paths or external URLs, saved as local image files, or copied into polled chat snapshots. Unsent previews remain in memory across page switches.

To import a portfolio screenshot, ask Codex to update the correct saved account. It reads the existing records and presents a **Review portfolio update** table with saved and proposed values. Select **Apply portfolio update** to save, or **Dismiss update** to discard. Stocks, option positions, brokerage cash and margin debt are supported. Missing fields and positions stay untouched; incomplete new positions require clarification instead of invented cost data. No positions are deleted. Cash and margin use the app's USD ledger. Portfolio changes commit in one atomic store write, reject a preview if that account changed in the meantime, and verify the saved file. They use the app's automatic backup queue; backup failures are reported as saved locally with a backup warning. A saved-data event refreshes the app's portfolio views. Autonomous monitoring cannot propose or approve portfolio updates.

The Agents page exposes the full Budget Terminal MCP catalog as dynamic tools through the same validated service routes used by external MCP clients. No separate MCP installation or configuration is needed inside Agents. Manual chat can read research and settings, capture app screenshots, and make requested changes to saved portfolios, articles, Cards, personal finance and settings. Shared mutation handlers retain automatic backups and saved-data refresh events. Portfolio screenshot imports still use the review-and-apply flow. Autonomous monitoring rejects every mutation tool at dispatch. Screenshot pixels are returned as image inputs alongside page metadata, and captures share a queue with external MCP clients. Connection status is available through `budget_terminal_connection_status`.

Thread creation disables execution environments, shell tools, plugins and configured MCP servers to avoid duplicate Budget Terminal tools and unrelated integrations. Maintenance and shell commands remain outside the MCP catalog. Unsupported server requests are rejected. Provider results retain their source, freshness and errors; failed envelopes are reported as failed tool calls and oversized research results explicitly report truncation.

Autonomous mode is **off on every application launch**. Connect, enter an objective, select a 5–60 minute interval and a 1–12 run limit, then explicitly enable it. The first run begins immediately; later runs begin after the preceding run completes. Monitoring runs in the main process while the window is on another page. It requires the app to remain open and does not run as an OS background service. Failures disable monitoring. Each run is bounded to 10 minutes and 80 tool calls. Stop or turning autonomous mode off cancels the active run, disconnects the agent and cancels scheduled work.

Conversations are saved locally across app restarts. **New chat** keeps the previous chat in **History**, creates a fresh ephemeral Codex thread on the existing connection, clears the visible conversation, draft, attachments and pending portfolio preview, and preserves model/thinking selections. It does not restart Codex, reconnect, or run inference. It is unavailable while a run or autonomous schedule is active. If creating the new thread fails, the previous conversation is retained with a visible error. **Stop** still cancels work and disconnects; startup auto-connect is attempted only once, so Stop does not trigger an automatic reconnection. Codex threads are ephemeral; agent snapshots remain excluded from persisted renderer caches. Reopening a chat starts a fresh ephemeral thread with bounded, explicitly untrusted recent transcript context (up to 60,000 characters, 20,000 per message); older messages can be viewed in History but may be absent from model context. Images, tool approvals and thread IDs are never restored. The browser companion shows the Agents workspace but history, connection and agent commands are desktop only.

## Private local history

**History** lists up to 100 saved chats, each retaining its latest 300 messages. Open a chat to continue it, or delete an inactive chat with the confirmation button. At launch the current saved chat is restored, even if connecting Codex fails. History, notification inbox and tracker definitions/state live together in `%APPDATA%/BudgetTerminalElectron/agents.json` on Windows (the app's user data folder on other platforms), **outside the source checkout**. The file is local JSON, not encrypted; protect access to your OS account. Atomic serialized writes and shutdown flushing protect saves. Storage failures stay visible; damaged files are not silently replaced. The file has a 50 MB limit.

**Chat history must not be committed or published to GitHub.** `.gitignore` excludes `agents.json`, temporary/backup copies and named chat-history exports anywhere in the repository, in addition to the entire runtime data directory. The `.githooks/pre-commit` check also rejects force-staged private Agents data. A `.githooks/pre-push` check scans the history being pushed, so deleting a private file in a later commit is not mistaken for removing it from earlier commits. `npm run probe:agent-privacy` verifies these exclusions and that no private runtime file is tracked. Only source and synthetic probe fixtures belong in Git. Agents data is deliberately excluded from portfolio backup/export bundles and browser query persistence. Using Codex still transmits your prompts and relevant restored context to your signed-in Codex account; this is distinct from publishing anything to GitHub.

## Notifications

**Notifications** is a persistent in-app inbox with unread/read state, per-item dismissal and **Mark all read**. A generic unread count is visible throughout the desktop app without exposing notification text on other pages. Codex uses `terminal_notify` in manual chat or autonomous monitoring, with a title, evidence/source body and stable event key. The same event key is deduplicated for 24 hours, with at most 10 notification requests per run. The inbox retains the latest 500 notifications. Desktop notifications are attempted only after the inbox entry is saved; unsupported/blocked/failed delivery is shown in the inbox and never loses the notification. Restoring the inbox does not replay desktop popups. Desktop notification text may be visible on the OS lock screen; ask Codex not to include sensitive portfolio details.

## Codex-written trackers

Ask Codex to write a tracker for any condition supported by the research tools—for example stock catalysts, a price-move reminder with an agreed comparison baseline, or a non-stock research event. Criteria are **not hard-coded**: Codex saves general, user-readable instructions using `terminal_save_tracker`; `terminal_trackers` lists definitions/status and `terminal_remove_tracker` removes one when requested. No JavaScript, shell commands or arbitrary executable scripts are evaluated.

Each definition includes a title, instructions, a 1–1440 minute check interval, a 1–10080 minute notification cooldown and a 1–1000 check run limit. New or edited trackers are **paused**. In **Trackers**, review the full instructions and click **Start tracker** to authorize checks and Codex usage; Pause cancels an in-flight check. Starting resets the run allowance. Definitions, memory and prior results persist, but every tracker pauses on app relaunch. Nothing runs with the app closed. Up to 50 trackers are retained.

Checks run sequentially in isolated ephemeral conversations, independently of the visible chat, using the selected model where available. Each check is bounded by the existing 10-minute/80-tool run limits and a 12-minute overall worker timeout. Only read-only app tools are dispatched: no financial mutations, tracker management, navigation or standalone notifications are permitted. The worker must call `terminal_tracker_report` once with **triggered**, **quiet** or **unknown**, a sourced summary and bounded memory for the next check. No report or an execution failure pauses the tracker with a visible error. Missing/stale evidence should be reported as unknown, never as a match. Only a triggered report can request a notification; cooldown and 24-hour per-event deduplication apply centrally. Cancellation ignores late results. The UI shows schedule, remaining checks, last check, full instructions, saved context, result and errors. **Stop** cancels autonomous chat and pauses all trackers; **New chat** does not remove tracker definitions.

Startup preloads the Agents snapshot alongside all other implemented pages and waits for the automatic Codex connection attempt, without running inference. Connection progress and failures are reflected in startup readiness; missing Codex or sign-in does not prevent the rest of the app from loading. Global desktop polling handles navigation requests while the Agents page is unmounted. The app acknowledges navigation and returns an error to Codex if it cannot open the requested page.

Validation:

```powershell
npm run typecheck
npm run probe:agents --workspace budget-terminal-desktop
npm run probe:agents --workspace budget-terminal-desktop -- --live
npm run probe:agents-ui --workspace budget-terminal-desktop
npm run probe:agents-workspace --workspace budget-terminal-desktop
npm run probe:agent-privacy
npm run probe:security --workspace budget-terminal-desktop
npm run probe:agents --workspace budget-terminal-desktop -- --live --live-image
npm run probe:navigation --workspace budget-terminal-desktop
npm run probe:loading --workspace budget-terminal-desktop
npm run probe:readiness-ui --workspace budget-terminal-desktop -- --agents
npm run build
```

The live probe uses one signed-in Codex conversation to test actual dynamic tool calls without requesting live financial data. UI and service probes use fixtures and temporary data directories.
