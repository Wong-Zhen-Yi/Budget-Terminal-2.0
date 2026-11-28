# src/pages (page components)

## Overview
One component per tab. There are 66 page files plus two folders for the Polymarket and Stock Discovery pages. Each page uses hooks from `api/` and state from `stores/`. Focus pages each have their own topic-specific layout ([AGENTS.md:Independent Focus Page Designs]).

## Interface
- Portfolio and personal finance: `PortfolioPage.tsx:PortfolioPage`, `PersonalFinancePage.tsx:PersonalFinancePage`, `MoneyPage.tsx:MoneyPage`, `CardsPage.tsx:CardsPage`, `BondsPage.tsx:BondsPage`, `BacktestPage.tsx:BacktestPage`, `ProjectionsPage.tsx:ProjectionsPage`, `ArticlesPage.tsx:ArticlesPage`, `NotificationsPage.tsx:NotificationsPage`.
- Markets and screens: `StocksPage.tsx:StocksPage`, `ChartsPage.tsx:ChartsPage`, `PricePage.tsx:PricePage`, `OptionsPage.tsx:OptionsPage`, `CryptoPage.tsx:CryptoPage`, `ForexPage.tsx:ForexPage`, `GlobalPage.tsx:GlobalPage`, `HeatmapPage.tsx:HeatmapPage`, `EtfPage.tsx:EtfPage`, `UpDownPage.tsx:UpDownPage`, `TradingVolumesPage.tsx:TradingVolumesPage`, `TechnicalScreenPage.tsx:TechnicalScreenPage`, `QuantPage.tsx:QuantPage`, `MarketCapPage.tsx:MarketCapPage`, `Sp500Page.tsx:Sp500Page`, `PreMarketPage.tsx:PreMarketPage`, `IpoPage.tsx:IpoPage`, `CalendarPage.tsx:CalendarPage`, `DictionaryPage.tsx:DictionaryPage`.
- Macro and economics: `MacroPage.tsx:MacroPage`, `EconomicPage.tsx:EconomicPage`, `OilPage.tsx:OilPage`, `GoldPage.tsx:GoldPage`, `InstitutionsPage.tsx:InstitutionsPage`, `PoliticsPage.tsx:PoliticsPage`.
- Company and research: `AmznPage.tsx:AmznPage`, `AvgoPage.tsx:AvgoPage`, `BmnrPage.tsx:BmnrPage`, `GooglPage.tsx:GooglPage`, `HimsPage.tsx:HimsPage`, `HoodPage.tsx:HoodPage`, `MuPage.tsx:MuPage`, `NvdaPage.tsx:NvdaPage`, `PltrPage.tsx:PltrPage`, `SofiPage.tsx:SofiPage`, `VstPage.tsx:VstPage`, `FundamentalsPage.tsx:FundamentalsPage`, `ValuationPage.tsx:ValuationPage`, `ScorecardPage.tsx:ScorecardPage`, `SemiconductorsPage.tsx:SemiconductorsPage`, `HomebuildersPage.tsx:HomebuildersPage`, `ProjectionsPage.tsx`, `DefeatBetaPage.tsx:DefeatBetaPage`.
- Crypto and prediction markets: `BitcoinPage.tsx:BitcoinPage`, `EthPage.tsx:EthPage`, `PolymarketPage.tsx:PolymarketPage`, `PolymarketExplorer.tsx:PolymarketExplorer`, `AnthropicPage.tsx:AnthropicPage`.
- News and browser: `NewsPage.tsx:NewsPage`, `NewsLitePage.tsx:NewsLitePage`, `YouTubePage.tsx:YouTubePage`, `BrowserPage.tsx:BrowserPage`.
- Agents and settings: `AgentsPage.tsx:AgentsPage`, `SettingsPage.tsx:SettingsPage`, `FocusDashboardPage.tsx:FocusDashboardPage`, `DashboardPage.tsx:DashboardPage`.
- Subfolders: [./polymarket/EGM.md](./polymarket/EGM.md), [./stockDiscovery/EGM.md](./stockDiscovery/EGM.md).

## Invariants
- Every implemented page loads at startup without waiting for its first visit ([AGENTS.md:Startup Page Readiness]).
- Page labels carry no readiness notes such as "Ready" or "Failed" ([AGENTS.md:No Global Diagnostics Banners]).
- Focus pages do not copy one another's layout ([AGENTS.md:Independent Focus Page Designs]).

## Side Effects
- Calls `window.api` directly from `BrowserPage.tsx`, `PricePage.tsx`, `QuantPage.tsx`, `CryptoPage.tsx`, `AnthropicPage.tsx`, `MoneyPage.tsx`, `DictionaryPage.tsx`, `NotificationsPage.tsx`, `ArticlesPage.tsx`, and `PolymarketExplorer.tsx`. Other pages reach the main process only through `api/` hooks.
- Uses `localStorage` or `fetch` in some pages (see the same list above).

## Verification
- Run: `npm run typecheck`
- Run: `npm run probe:readiness-ui` (after `npm run build`)
