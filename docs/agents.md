# Agents

Codex connects automatically when the desktop app starts, even if Agents is not the active page. Open **Agents** in the sidebar to chat. If startup connection fails, the error stays visible; fix the installation or sign-in and select **Connect Codex** to retry. This uses the supported [Codex app-server protocol](https://learn.chatgpt.com/docs/app-server) through a private stdio connection in Electron's main process. Dynamic tool calls require the experimental app-server capability.

Install Codex CLI and run `codex login` once if a signed-in installation is unavailable. Windows also detects the desktop Codex binary in `%LOCALAPPDATA%/Programs/OpenAI/Codex/bin`. `BUDGET_TERMINAL_CODEX_PATH` can select an executable on other installations. The selected account's configured model is used initially; no model or API key is hard-coded. Usage follows that account.

The **Model** and **Thinking mode** selectors show the connected Codex runtime's current settings. Options come from its paginated `model/list` catalog, including each model's supported reasoning efforts. Model changes reset thinking to that model's default. Changes apply to subsequent chat and autonomous runs without clearing the conversation, and controls are locked while a run or autonomous schedule is active. Selections survive page changes and reconnects for this app session. A listed model's inference access is confirmed when its run succeeds; access errors appear in the conversation status.

The standard launchers check the detected Codex executable with `--version` and pass its absolute path to Electron. This also handles native Windows executables installed behind npm shims. A missing or broken Codex installation leaves the rest of Budget Terminal usable. Launching the app connects the installed, signed-in Codex runtime but never sends a message, runs inference or enables autonomous mode. A failed connection does not block other pages.

## Chat from the top bar

The **Ask Agent…** box in the top bar is available from every page. Click the field or dropdown arrow to open a full chat below the title bar without navigating away. Type and press **Enter** (or the send arrow) to send directly; the dropdown focuses its full composer for follow-up messages. Typing alone never sends a message or starts inference.

A live badge beside the top-bar input shows **Thinking**, **Researching** while research tools run, **Writing** while a response streams, and **Creating image** during image generation. It remains visible with the dropdown closed and shows **Done** only after a successful completed turn—not simply because an older assistant message exists. New chat clears the completion state. Failed sends/runs show **Error**, cancellation shows **Stopped**, and disconnected/startup states show **Disconnected** or **Connecting**. Portfolio proposals show **Review needed**. Sending gives immediate Thinking feedback while IPC starts the run. Parallel research remains Researching until all active research calls return. Privacy-obscured/screenshot states show only Hidden; no research subject or private tool arguments appear in the badge. Active dots pulse unless reduced motion is enabled.

The dropdown includes the existing transcript, formatted replies and inline charts, attachments/image paste, model/thinking settings, connection controls, Stop, New chat, History, Notifications, Trackers and portfolio review. It shares one connection, conversation, draft and attachment list with Agents and Dashboard 2—not a separate agent session. Closing the dropdown with **Esc**, **Close**, the arrow or an outside click keeps drafts and ongoing work intact. Closing explicitly returns focus to the top-bar field. Reopen it to see responses produced while closed. Sending is locked across all chat surfaces while a command is pending; failed sends remain visible and preserve the draft.

The dropdown is nonmodal so the current page remains accessible. It fits below the Windows or macOS title bar, with an independently scrolling transcript and a visible composer. The top-bar clock/brand condense at narrower window sizes to retain a usable chat field. Agent text and the dropdown are hidden during app screenshot capture and while Agents is privacy-obscured; page search also dismisses the chat. Revealing Agents restores the unsent draft but does not automatically reopen the dropdown. No unsent text or image bytes are persisted in renderer storage.

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

Ask “Show AAPL's price chart in this chat” to display a **full-history interactive chart** on Agents, Dashboard 2 or the top-bar dropdown without navigating away. Market charts default to **Max daily history**, not a model-selected 200-bar sample. The app loads all usable provider bars, including pre-1970 history where available. Source, freshness, fetched time, actual first/last dates and total candle count stay visible; full available history means provider coverage, not a promise of inception coverage.

Use **1D, 5D, 1M, 3M, 6M, YTD, 1Y, 5Y, Max** to change the view while retaining the entire source history. **Candle interval** offers 1/5/15-minute, 1/4-hour, daily, weekly and monthly bars. Changing interval loads Max for that interval and resets the view to Max. Intraday provider limits are explicitly disclosed: up to 6 days for 1-minute bars, 59 days for 5/15-minute bars and 729 days for hourly/4-hour bars. Daily, weekly and monthly choices expose longer history.

Scroll to zoom, drag to pan and hover for crosshair OHLC values. **Zoom +**, **Zoom −**, **Reset view** and **Candlesticks / Close line** work directly inside chat. With the plot focused, use **+/−**, **←/→** and **Home** for keyboard zoom, pan and reset. Range selections and zoom survive Agent polling and streamed analysis. **Show OHLC data** exposes exact values with 100-row pagination, including First/Last navigation, without creating thousands of hidden table rows. Dates/times are UTC. Loading, failed/retry, stale and partial coverage remain visible; invalid or duplicate provider bars are excluded with a warning, never replaced with invented prices.

The agent emits a small, validated ticker reference rather than copying/truncating market data into its answer:

````markdown
```candlestick
{"title":"AAPL price history","symbol":"AAPL","caption":"Select a range and candle interval below to explore the history."}
```
````

Title and provider symbol are required for market charts; unit and caption are optional. Symbols accept ordinary provider tickers, indexes, crypto/FX pairs and futures (for example `BRK-B`, `^GSPC`, `BTC-USD`, `EURUSD=X`, `GC=F`), never URLs or file paths. Prices come from the existing trusted chart IPC/service behind Yahoo's shared rate gate, using the same cache as Charts. View changes never send Agent prompts, start inference, navigate, or modify saved data. All symbol-backed charts in the restored current conversation preload during startup even if Agents is hidden/unvisited; chart failures keep startup visibly failed/degraded instead of silently ready. The conversation saves the ticker reference, not a frozen market-data snapshot: reopening it shows freshly loaded/cached history with its current metadata.

Older saved `candlestick` blocks with 1–200 inline OHLC bars remain readable but are clearly labelled **Provided data only**, not full market history. Enter the actual ticker and choose **Load full history** to upgrade that view without guessing an instrument from its title or starting inference. Legacy OHLC still requires finite prices inside low/high bounds and strictly increasing valid daily dates or UTC ISO timestamps. The JSON block is bounded to 60,000 characters; malformed/incomplete/invalid references or data show a safe, readable fallback. No remote images, model-supplied HTML/styles, or executable chart scripts are used.

Paste a screenshot into the message box with **Ctrl+V**, choose **Attach image**, or drag images onto the composer. PNG, JPEG and WebP are supported, with up to four images, 8 MB each and 20 MB total per message. Previews can be removed before sending, and an image can be sent without accompanying text. Image bytes travel through the desktop IPC bridge into Codex's image inputs; arbitrary local paths and external URLs are never accepted. Sent images now appear as inline cards and are saved privately as raster artifacts; only their IDs/names appear in polled chat snapshots. Unsent previews remain in memory across page switches and are not persisted.

## Generate, edit and display images

Ask “Generate a minimalist illustration of a bull and bear” to create an image directly in chat. Attach an image and ask for a specific edit, or click **Use for edit** beneath an uploaded/generated image to attach its actual pixels to your next message. **Expand image** shows a larger inline view. Images display on Agents, Dashboard 2 and the top-bar dropdown; no navigation or external image URL is needed.

Generation and editing use the installed Codex runtime's **native image generation tool**, your existing signed-in account/provider, and its image allowance. No separate API key is stored by Budget Terminal. A compatible runtime/provider is required; availability appears under Controls and quota/provider errors stay visible in chat. Generation can take several minutes. The app supports four generated images per run, PNG/JPEG/WebP only, 8 MB each. It does not interpret SVG, HTML, remote URLs, Markdown image links or model-provided file paths as images. Generated illustrations are labelled AI-generated and must not be treated as market data or evidence; factual price/allocation charts still use the native chart blocks.

Native image tools are enabled for manual chat and disabled in autonomous/tracker threads. Switching between manual and autonomous work creates a fresh ephemeral thread with bounded transcript context so the runtime cannot retain a previously enabled image tool in autonomous mode. Stop marks unfinished image cards as interrupted; late results cannot revive a stopped or replaced chat. Reopening a chat restores image cards, not image bytes in model context: use **Use for edit** to send the target pixels again.

The private `agent-images/` directory alongside `agents.json` holds bounded, atomically written image artifacts, capped at 1000 images / 512 MB. Missing, corrupt or oversized artifacts have a visible fallback. Images are fetched through trusted IPC by opaque IDs only when their cards approach the viewport; pixels never enter status polling, transcript JSON, automatic portfolio backups, Git or persisted renderer caches. Deleting an inactive chat removes its unshared app-managed artifacts; artifacts no longer referenced after the 300-message retention limit may remain until local cleanup. Codex may independently retain native image outputs in its own private generated-image cache; deleting the app copy does not delete provider/Codex copies. Like chat history, local images are not encrypted. `.gitignore` and Git privacy hooks protect `agent-images/` copies anywhere in the checkout.

To import a portfolio screenshot, ask Codex to update the correct saved account. It reads the existing records and presents a **Review portfolio update** table with saved and proposed values. Select **Apply portfolio update** to save, or **Dismiss update** to discard. Stocks, option positions, brokerage cash and margin debt are supported. Missing fields and positions stay untouched; incomplete new positions require clarification instead of invented cost data. No positions are deleted. Cash and margin use the app's USD ledger. Portfolio changes commit in one atomic store write, reject a preview if that account changed in the meantime, and verify the saved file. They use the app's automatic backup queue; backup failures are reported as saved locally with a backup warning. A saved-data event refreshes the app's portfolio views. Autonomous monitoring cannot propose or approve portfolio updates.

The Agents page exposes the full Budget Terminal MCP catalog as dynamic tools through the same validated service routes used by external MCP clients. No separate MCP installation or configuration is needed inside Agents. Manual chat can read research and settings, capture app screenshots, and make requested changes to saved portfolios, articles, Cards, personal finance and settings. Shared mutation handlers retain automatic backups and saved-data refresh events. Portfolio screenshot imports still use the review-and-apply flow. Autonomous monitoring rejects every mutation tool at dispatch. Screenshot pixels are returned as image inputs alongside page metadata, and captures share a queue with external MCP clients. Connection status is available through `budget_terminal_connection_status`.

Thread creation disables execution environments, shell tools, plugins and configured MCP servers to avoid duplicate Budget Terminal tools and unrelated integrations. Maintenance and shell commands remain outside the MCP catalog. Unsupported server requests are rejected. Provider results retain their source, freshness and errors; failed envelopes are reported as failed tool calls and oversized research results explicitly report truncation.

Autonomous mode is **off on every application launch**. Connect, enter an objective, select a 5–60 minute interval and a 1–12 run limit, then explicitly enable it. The first run begins immediately; later runs begin after the preceding run completes. Monitoring runs in the main process while the window is on another page. It requires the app to remain open and does not run as an OS background service. Failures disable monitoring. Each run is bounded to 10 minutes and 80 tool calls. Stop or turning autonomous mode off cancels the active run, disconnects the agent and cancels scheduled work.

Conversations are saved locally across app restarts. **New chat** keeps the previous chat in **History**, creates a fresh ephemeral Codex thread on the existing connection, clears the visible conversation, draft, attachments and pending portfolio preview, and preserves model/thinking selections. It does not restart Codex, reconnect, or run inference. It is unavailable while a run or autonomous schedule is active. If creating the new thread fails, the previous conversation is retained with a visible error. **Stop** still cancels work and disconnects; startup auto-connect is attempted only once, so Stop does not trigger an automatic reconnection. Codex threads are ephemeral; agent snapshots remain excluded from persisted renderer caches. Reopening a chat starts a fresh ephemeral thread with bounded, explicitly untrusted recent transcript context (up to 60,000 characters, 20,000 per message); older messages can be viewed in History but may be absent from model context. Saved image cards can be viewed again, but image pixels, tool approvals and thread IDs are not automatically restored into model context. The Agents workspace, history, connection and commands are available in the desktop app only.

## Private local history

**History** lists up to 100 saved chats, each retaining its latest 300 messages. Open a chat to continue it, or delete an inactive chat with the confirmation button. At launch the current saved chat is restored, even if connecting Codex fails. History, notification inbox and tracker definitions/state live together in `%APPDATA%/BudgetTerminalElectron/agents.json` on Windows (the app's user data folder on other platforms), **outside the source checkout**. The file is local JSON, not encrypted; protect access to your OS account. Atomic serialized writes and shutdown flushing protect saves. Storage failures stay visible; damaged files are not silently replaced. The file has a 50 MB limit.

**Chat history must not be committed or published to GitHub.** `.gitignore` excludes `agents.json`, the private `agent-images/` directory, temporary/backup copies and named chat-history exports anywhere in the repository, in addition to the entire runtime data directory. The `.githooks/pre-commit` check also rejects force-staged private Agents data. A `.githooks/pre-push` check scans the history being pushed, so deleting a private file in a later commit is not mistaken for removing it from earlier commits. `npm run probe:agent-privacy` verifies these exclusions and that no private runtime file is tracked. Only source and synthetic probe fixtures belong in Git. Agents data is deliberately excluded from portfolio backup/export bundles and persisted renderer query caches. Using Codex still transmits your prompts and relevant restored context to your signed-in Codex account; this is distinct from publishing anything to GitHub.

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
npm run probe:agent-images --workspace budget-terminal-desktop
npm run probe:agent-images --workspace budget-terminal-desktop -- --live
npm run probe:agents --workspace budget-terminal-desktop -- --live
npm run probe:agents-ui --workspace budget-terminal-desktop
npm run probe:agents-topbar-ui --workspace budget-terminal-desktop
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
