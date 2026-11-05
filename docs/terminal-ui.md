# BT Portfolio and Agents TUI

Run `npm run tui`, use the installed `bt` command on Windows, or choose BT in the
double-click launcher. Portfolio opens immediately and loads prices for every saved
portfolio, including the combined book, using the same store, providers, rate gate
and valuation calculations as the desktop app. No Electron window starts.

- Left/Right: switch portfolios without changing the desktop's active selection.
- R: reload saved holdings and refresh prices across all portfolios.
- H: hide or reveal numeric portfolio values.
- C: toggle the candlestick chart. Up/Down selects a holding, 1/2/3 selects hourly,
  daily or weekly candles, and + / - zooms in or out.
- Tab: switch between holdings and saved option contracts.
- Up/Down: move through rows that do not fit in the viewport.
- Q / Ctrl+C: exit and restore the terminal.
- F2 (or A from Portfolio): open Agents. F1 returns to Portfolio.

Holdings show shares, price, market value and unrealized P&L. At 110 columns or wider,
they also show average cost, daily change and allocation weight. Cash, margin and net
value use the desktop's inclusion settings. Missing prices display `--`; incomplete
valuations never appear as complete totals. Quote source labels identify perpetual
marks and stock quote fallbacks; stale cached prices are identified when returned.
Options show saved contract details, without live option valuation. Edit holdings,
portfolios, cash, margin and options in the desktop Portfolio page, then press R.

Charts render genuine OHLC bodies and high/low wicks, with green up candles, red down
candles and amber dojis. Each plotted bar is one provider candle; narrow screens show
fewer recent bars without averaging them. Price axes, UTC dates, currency and history
source stay visible. H masks price labels and OHLC values while leaving the chart
shape visible. The chart fits the current terminal and requests a larger viewport
when there is insufficient room. Daily histories for all holdings preload at startup;
other intervals load when selected. R refreshes daily charts and the selected interval.
Missing history shows an explicit empty/error state; a failed refresh preserves and
labels previous candles. The existing chart service supplies stock history or labeled
equity perpetual candles, keeping market sources separate.

The view uses the existing dark palette and clips to the viewport. It prints no local
store paths or raw provider errors. Saved data stays in the app's normal local store;
no portfolio fixtures or personal data are bundled into the TUI.

Agents loads its saved conversation and connects at startup, alongside Portfolio
and chart preloading. It uses the same Codex engine, available model catalog, live
web research and validated market-data tools as desktop Agents. Install Codex CLI
and sign in with `codex login` on this computer, then use `/connect` to retry if
needed. The TUI reads desktop MCP category permissions at startup and restricts its
tools to research reads. Saved-data edits, signed-in Browser access, desktop
navigation, screenshots, Telegram delivery and scheduled trackers remain in the
desktop app. TUI research needs no open desktop window.

Type a message and press Enter to send. Replies stream into a wrapped transcript.
Use Up/Down or Page Up/Page Down to read earlier text; scrolling up preserves your
position as replies arrive. Left/Right, Home/End, Backspace and Delete edit the
composer; Ctrl+U clears it. Escape clears the draft and closes the history view.
Letters such as Q, R, A and C enter text while Agents is selected. Ctrl+C exits
from either view, stops research and flushes chat history before closing.

| Command | Action |
| --- | --- |
| `/help` | Show available chat commands |
| `/connect` | Connect or retry Codex |
| `/new` | Start a saved conversation |
| `/history` | Show numbered saved TUI chats |
| `/open N` | Reopen a numbered chat |
| `/model` or `/model ID` | List available models or select one |
| `/thinking` or `/thinking MODE` | List supported thinking modes or select one |
| `/limit N` | Set the manual run limit to 5–30 whole minutes |
| `/stop` | Stop research; reconnect before sending again |
| `/continue` | Continue the most recent interrupted research run |

TUI history, model/thinking choices and recovery details are saved in
`tui-agents.json` in the app's private local data folder. Desktop and Telegram chat
histories remain separate. An OS-managed lock prevents two TUIs from overwriting
the same history. API keys, passwords, Codex credentials and raw request errors are
not written into the repository or displayed as diagnostic messages.

Validation:

```sh
npm run typecheck
npm run probe:tui
npm run tui -- --build-only
npm run probe:launcher
```

`npm run tui -- --help` prints usage without building or accessing saved data.
