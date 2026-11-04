# GitHub screenshot gallery

These PNGs show implemented Budget Terminal views in the existing dark theme.
All displayed financial records, market values, probabilities, headlines, and
company comparison figures are illustrative samples. They are not live data.

The Dashboard, Charts, and Portfolio captures use an isolated demo profile.
The additional feature captures render the real React page components in isolated
Electron windows with the application's built stylesheet and synthetic fixtures.
They show page content without the desktop navigation shell. Electron user data,
`APPDATA`, and `LOCALAPPDATA` are redirected to temporary directories; personal
profiles, saved credentials, browser sessions, and Agent conversations are not used.

| Image | Feature | Capture source |
| :--- | :--- | :--- |
| [Dashboard](dashboard.png) | Market snapshots, holdings, charting, and options | Isolated demo profile |
| [Charts](charts.png) | Candlesticks, volume, technical tools, and portfolio context | Isolated demo profile |
| [Portfolio](portfolio.png) | Position values, gains, and allocation | Isolated demo profile |
| [Polymarket](polymarket.png) | Market cards, probability history, depth, and activity | `probe-polymarket-ui.ts` synthetic fixture |
| [Semiconductors](semiconductors.png) | Supply-chain stages, company filtering, and subsector returns | `probe-semiconductors-ui.ts` synthetic fixture |
| [Crypto](crypto.png) | Spot watchlist, perpetual candles, breadth, and venue statistics | `probe-crypto-ui.ts` initial prepared demo state |
| [Scorecard](scorecard.png) | Company financials, valuation columns, and revenue-growth comparison | `probe-scorecard-ui.ts` initial prepared demo state at a wider viewport |
| [Dictionary](dictionary.png) | Offline terms, saved entries, and an illustrated Ascending Channel | `probe-dictionary-ui.ts` pattern capture |

Capture sources are in `apps/desktop/scripts/`. The Crypto capture uses software
rendering so the chart canvas appears in the exported PNG. The Scorecard capture
stops after its initial data and chart checks, before interaction scenarios.
Captures are direct Electron screenshots; no market values or UI elements were
painted onto the images afterward.

Before publishing a new capture, inspect the entire image for personal data,
empty charts, loading states, clipped content, and accidental error overlays.
Keep demo labels and image descriptions in the root README accurate.
