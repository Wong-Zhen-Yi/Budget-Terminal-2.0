# GitHub screenshot gallery

Captured on 24 November 2026 from the current production Electron build at
1600 × 1000 CSS pixels, using the repository's disposable demo session.
All six desktop images include the actual desktop navigation and the **Demo data** label.

| Image | Rendered page |
| :--- | :--- |
| [Portfolio](portfolio.png) | Demo Core Portfolio positions, cost basis, values, and gains |
| [Dashboard 2.0](dashboard-2.png) | Demo portfolio, allocation, heatmap, and disconnected Agent workspace |
| [Personal Finance](personal-finance.png) | Fictional cash, debts, recurring bills, and reserve goal |
| [Charts](charts.png) | Provider price history, technical tools, and demo watchlists |
| [Focus Dashboard](focus-dashboard.png) | Current company, sector, digital-asset, and macro topics |
| [Dictionary](dictionary.png) | Offline reference with the Relative Strength Index entry |

## Reproduce

From the repository root with a supported Node.js runtime:

```sh
npm run build
node scripts/capture-demo.cjs
node scripts/capture-demo.cjs --mobile
```

The capture script starts the real built main process, preload, renderer, IPC,
and data services. It seeds the checked-in [demo fixture](../../../fixtures/demo-user-data.json)
through [demo-session.cjs](../../../scripts/demo-session.cjs), uses the page picker,
and exports each window with Electron's `capturePage`. GPU rendering is disabled
for reproducible chart canvas capture. No UI or values are painted onto the PNGs.

Saved holdings and finance records are fictional. Market quotes, FX, fundamentals,
and history come from the normal public providers during capture, so reproducing
these screenshots can yield different values or coverage. The sample option may
lack a mark; Personal Finance then shows incomplete net worth and an unavailable
goal calculation. Some Focus tiles may lack provider metrics. These states are
preserved in the captures.

`APPDATA`, `LOCALAPPDATA`, application data, Downloads, browser storage, and
`CODEX_HOME` are isolated in a fresh temporary directory and removed after exit.
The script dismisses sign-in and uses the real Stop and New chat commands so no
signed-in agent or personal conversation is needed. It does not use personal
portfolios, browser sessions, or saved credentials; demo cloud sync is disabled.

Inspect every image before publication for personal data, empty charts, loading
states, clipping, and unexpected overlays. The root README uses the current desktop and mobile
captures listed here. Other PNGs in this folder are older feature captures and
are not part of the current gallery.

## Mobile showcase

The mobile capture uses the actual disposable Electron mobile preview at 390 × 844
CSS pixels with a 2× emulated device density; exported PNGs are 390 × 844 pixels.
It opens Portfolio, Dashboard 2.0, Charts, and Workspaces
through the mobile navigation controls. These are responsive app renders, not
physical-device screenshots or phone mockups. They do not establish Safari or
Android-browser compatibility.

| Image | Rendered mobile view |
| :--- | :--- |
| [Portfolio](mobile-portfolio.png) | Compact portfolio summary and demo positions |
| [Dashboard 2.0](mobile-dashboard-2.png) | Stacked demo portfolio and allocation panels |
| [Charts](mobile-charts.png) | Compact chart controls and price history |
| [Workspaces](mobile-workspaces.png) | Searchable page pills grouped by workspace |
