#!/bin/sh
echo "MCP upgraded: typed results, research workflows, stable paging, structured errors, durable write recovery and category permissions in Settings. All pages still preload."
echo "Settings dashboard: heading removed; real memory, provider latency and automatic backup size charts. Request activity supports partially measured provider queues."
echo "Portfolio Momentum Tracker now shows one value candlestick per trading day, using adjusted holding OHLC, a daily value EMA and private-number masking."
echo "Settings App dashboard: 18 compact charts show real local metrics; protected data stays hidden and missing telemetry is explicit. All pages still preload."
echo "TUI: compact tables and detail panes; Charts supports ticker entry, candles, line, volume and zoom. Arrows navigate; Space selects."
set -eu
cd "$(dirname "$0")"
exec node scripts/tui.cjs "$@"
