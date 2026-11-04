# Budget Terminal in PowerShell

Double-click **Launch Budget Terminal.cmd** once to install the per-user `BT`
command and open the terminal interface. Open a new PowerShell window and type:

```powershell
BT
```

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

Workspaces: Portfolio, Markets, Charts, News, Crypto, Finance, Research and Settings.
Every data workspace starts loading immediately. Left/Right switches workspaces;
Up/Down selects rows in compact tables or scrolls other content. Portfolio,
market prices, news, crypto and finance have dedicated tables. At 112 columns
or wider, the selected record appears in a side pane; narrower terminals put
a short detail section under the table. Enter opens the complete selected
record. Escape returns. `d` opens all response data and source diagnostics.
Prices preserve currency and instrument basis; portfolio cost basis is not
labelled as a live valuation, and finance rows preserve their native currency.

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

Tab/Shift+Tab also switches workspaces. PageUp/PageDown and Home/End scroll.
Optional shortcuts: `r` reloads, `/` enters a command, and `q` or Ctrl+C exits.
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

The chart shows a price axis, UTC date axis, volume bars and cursor OHLC.
Filled bodies rise and shaded bodies fall. Dense candles are grouped by
screen column while preserving open, high, low, close and total volume;
inspection reports the original selected candle. The chart needs at least
32 columns and enough rows for the plot; 100×30 or larger is recommended.
Zoom and inspection work locally without more provider calls. Ticker and
timeframe changes reuse the application's existing history service and rate
gate. A new selection cancels the previous request so late responses cannot
replace the current chart. History and current-quote sources are labelled
separately, including stock versus equity-perpetual instruments.

`tools` lists the available read-only services. `tool <name> <JSON>` uses the
request schemas in `apps/desktop/mcp/schemas.json`. Data views preserve source,
freshness, instrument labels and provider warnings. Interactive price charts
are available in the TUI; embedded browsers, video and record editing remain in the GUI.
The TUI issues no mutations or broker orders and writes no response transcripts.
Detailed startup failures are in desktop Settings; terminal Settings tracks its
own workspace requests. The desktop global loading banner and bottom status
strip remain hidden.

On macOS/Linux use `npm run tui` after installing dependencies. Double-click
launchers are provided for Windows only; use `npm run dev` for the desktop window.
