# Budget Terminal in PowerShell

Double-click **Launch Budget Terminal.cmd** to install or repair dependencies,
check the desktop and terminal builds, and install the per-user `bt` and `btd`
commands. Setup then shows **BTD - Desktop app** first, selected by default:
press **Enter** to open it. Press **Down** then **Enter** to open **BT - Terminal
interface** instead. **Up/Down** or **1/2** chooses an interface; **Esc** closes
the launcher. You can also open a new PowerShell or Command Prompt window and type:

```powershell
BT
```

Type `btd` instead to open the desktop app. Keep the launcher or terminal used to
open the app running while you use it.

From the checkout, `npm run setup:tui` installs the command and `npm run tui`
starts it directly. Installation requires no administrator access and does not
change your PowerShell profile. The command points at this checkout; rerun setup
after moving it. Remove it with `powershell -NoProfile -ExecutionPolicy Bypass
-File scripts/install-bt.ps1 -Uninstall`.

The TUI reuses a running desktop app. If none is running, it builds changed
sources and starts Electron with a hidden renderer so all implemented desktop
pages still preload. Closing the TUI gracefully closes its own background
instance; an existing desktop stays open. Running `npm run dev`
reveals the background instance and keeps it alive after the TUI closes.
Initial builds and provider requests can take time. Dependencies must already
be installed (`npm install`).

The TUI uses the desktop's page labels and workspace groups: Overview, Markets,
Research, Focus, Trading, Macro & events, My money, Articles, Agents and
Notifications, with a separate Settings page. It starts on Dashboard 2.0.
Press `p` to find a page or `w` to choose a workspace. Type a word to filter
the menu, then Enter or Space to select. Left/Right and Tab/Shift+Tab step
through pages. All supported data pages preload, including unvisited ones;
News, Calendar and YouTube use saved portfolio tickers. The Dashboard pages
share the Portfolio view and offer news and global markets as data sections.

Up/Down selects rows or scrolls details. Research services show readable
collection tables; `[` and `]` cycle sections when a response has several
collections. `f` filters rows; submit an empty filter to show every row again.
On pages with a symbol request, `s` changes the ticker in that page. The
Dictionary reads the desktop's complete offline catalog, with searchable terms
and full definitions and article sections. At 112 columns
or wider, the selected record appears in a side pane; narrower terminals put
a short detail section under the table. Enter opens the complete selected
record. Escape returns. `d` opens all response data and source diagnostics.
Press `b` on Portfolio or either Dashboard to select a saved book. The stock
table uses the desktop's shared calculations for marks, market value, P&L and
weights. Summary totals respect counted cash, margin debt and excluded holdings.
Missing USD marks withhold totals and weights; foreign-currency prices are never
silently treated as USD. Equity-perpetual and stock-close instruments retain
their labels. Saved option records are available through `d`; option mark
valuation and editing remain in the desktop app. Finance rows retain their
native currency. Request freshness and failures stay in Settings and `d`.

Press **Space** to open Actions. Use Up/Down to
highlight an action and Space to activate it. Refresh, ticker selection, quotes,
charts, company research, the research service browser and Quit are available this way.
Saved portfolio tickers are included in ticker selection. In menus, Left or
Escape goes back; Right or Enter also activates the selected item.
Type a partial word to filter a menu; Backspace removes characters. Space
activates the highlighted item. Choose **Type another ticker** to enter a
symbol that is not in the picker. Command entry accepts spaces normally.

For example: Space, Down twice, Space opens company ticker selection; choose
a ticker with Up/Down and press Space to load it. No command typing is needed.
Services with complex request schemas offer an optional custom JSON entry.

PageUp/PageDown and Home/End scroll or move through table rows.
Optional shortcuts: `r` or F5 reloads the current data page, `/` enters a
command, and `q` or Ctrl+C exits. TUI data is a snapshot; refresh after desktop
edits or to fetch new quotes.
The terminal restores its cursor and previous screen on exit.

Research commands:

```text
chart AAPL
quote AAPL MSFT NVDA
stock AAPL
tools
tool crypto {}
```

## Terminal charts

Charts starts loading SPY daily history for one year at launch. Enter
`chart AAPL` with `/`, or use Space > Chart a ticker. The selected portfolio
or quote row also has a **Chart selected ticker** action.

- `s`: type a different symbol, then Enter; Escape cancels.
- `t`: choose a lookback range, then candle interval with arrows and Space.
- `c`: switch candlesticks and a close-price line.
- `+` / `-`: zoom the number of visible candles; Actions also offers Fit all.
- Enter: inspect candles. Left/Right moves the cursor; Up/Down zooms.
- Home/End during inspection jumps to the oldest/newest candle.
- Escape: leave inspection so Left/Right switches workspaces again.

The chart shows sparse price ticks, multiple UTC date/time ticks, a labelled
close-price guide, volume bars and cursor OHLC. Candles have a blank column
between them: filled bodies rise, shaded bodies fall and a dash marks an
unchanged price. Line charts use sub-cell resolution for smoother curves.
The volume panel expands to two or three rows when space permits.
Dense candles are grouped into spaced OHLC bars, with the group count shown,
while preserving open, high, low, close and total volume;
inspection reports the original selected candle. The chart needs at least
32 columns and enough rows for the plot; 100×30 or larger is recommended.
Zoom and inspection work locally without more provider calls. Ticker and
timeframe changes reuse the application's existing history service and rate
gate. A new selection cancels the previous request so late responses cannot
replace the current chart. History and current-quote sources are labelled
separately, including stock versus equity-perpetual instruments.
The close-price guide follows the selected original candle during inspection.
Fetch times, freshness and request warnings are available in Settings or `d`
response details, keeping the chart workspace focused on the plot.

`tools` lists the available read-only services. `tool <name> <JSON>` uses the
request schemas in `apps/desktop/mcp/schemas.json`. Data views preserve source,
freshness, instrument labels and provider warnings. Interactive price charts
are available in the TUI. Pages requiring interactive desktop features explain
how to open them with `BTD`: Browser, Agents, Notifications, Scorecard, Beta,
Polymarket, DefeatBeta section selection and Backtest configuration. Video
playback and record editing also remain in the desktop app. The Tool console
retains access to read-only research services with custom request schemas.
The TUI issues no mutations or broker orders and writes no response transcripts.
Detailed startup failures are in desktop Settings; terminal Settings tracks its
own workspace requests. The desktop global loading banner and bottom status
strip remain hidden.

On macOS/Linux use `npm run tui` after installing dependencies. Double-click
launchers are provided for Windows only; use `npm run dev` for the desktop window.
