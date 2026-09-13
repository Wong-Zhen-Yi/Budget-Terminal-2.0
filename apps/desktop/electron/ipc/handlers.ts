import { getBitcoin } from '../services/bitcoin.js'
import type { Sp500Request, Sp500BreadthRequest } from '../shared/sp500.js'
import { BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { writeFile } from 'node:fs/promises'

import type {
  BacktestRequest,
  AnalyticsRequest,
  AppSettingsMutation,
  CardsMutation,
  CardsPerformanceRequest,
  ChartRequest,
  ChartsCompareRequest,
  ChartsHistoryRequest,
  ChartsRelationshipRequest,
  CalendarMonthRequest,
  BmnrRequest,
  CryptoRequest,
  GoldRequest,
  OilRequest,
  EarningsCalendarRequest,
  HeatmapRequest,
  InstitutionActivityRequest,
  InstitutionTickerActivityRequest,
  EtfArbitrageRequest,
  EtfAumRequest,
  EtfHoldingsRequest,
  Envelope,
  MaintenanceAction,
  MaintenanceResult,
  FundamentalsRequest,
  FundamentalsPageRequest,
  FxRequest,
  GlobalMarketsRequest,
  PreMarketRequest,
  MarketCapRequest,
  PriceScreenRequest,
  SignalsRequest,
  TradingVolumesRequest,
  StocksRequest,
  MomentumRequest,
  OptionQuotesRequest,
  PersonalFinanceMutation,
  ReturnsRequest,
  NewsRequest,
  NewsPageRequest,
  NewsTickerSearchRequest,
  NewsPreviewRequest,
  NewsThumbnailRequest,
  PortfolioMutation,
  OptionsRequest,
  OptionsChainRequest,
  OptionsExpirationsRequest,
  ProjectionsRequest,
  QuotesRequest,
  TargetsRequest,
  UpDownRequest,
  UpDownTargetsRequest,
  ValuationRequest,
  EconomicRequest,
  MoneyRequest,
  IpoCompletedRequest,
  IpoUpcomingRequest,
  PoliticsExportRequest,
  PoliticsPageRequest,
  QuantPairRequest,
  QuantScanRequest,
  RollRequest,
  YouTubeRequest,
  YouTubeThumbnailRequest,
  WindowAction,
} from '../shared/contract.js'
import { getForexQuotes, getForexHistory, getForexNews } from '../services/forex.js'
import { CHANNELS } from '../shared/contract.js'
import { ok } from '../shared/envelope.js'
import { yahooProvider } from '../services/provider.js'
import { runWithPriority } from '../services/yahoo/client.js'
import { watchPortfolios } from '../services/portfolioStore.js'
import { isSafeExternalUrl } from '../services/urls.js'
import { getApiUsageSnapshot } from '../services/apiUsage.js'

export function registerIpcHandlers(): () => void {
  const provider = yahooProvider

  ipcMain.handle(CHANNELS.apiUsage, () => getApiUsageSnapshot())

  /**
   * Register a provider channel in the rate gate lane its request asks for.
   *
   * The warm-up sets `background: true` (see `BackgroundRequest` in the contract), and
   * `runWithPriority` puts the whole fan-out that handler starts — however many awaits
   * deep — into the background lane. Everything else is foreground, which is what makes a
   * page the user just opened jump the warm-up's queue. The maintenance, window and
   * clipboard channels below touch no Yahoo and are registered directly.
   */
  const handle = <Request>(channel: string, run: (request: Request) => unknown): void => {
    ipcMain.handle(channel, (_event, request: Request) =>
      runWithPriority(
        (request as { background?: boolean } | undefined)?.background
          ? 'background'
          : 'foreground',
        async () => run(request),
      ),
    )
  }

  handle(CHANNELS.quotes, (request: QuotesRequest) => provider.quotes(request))
  handle(CHANNELS.chart, (request: ChartRequest) => provider.chart(request))
  handle(CHANNELS.chartsHistory, (request: ChartsHistoryRequest) =>
    provider.chartsHistory(request),
  )
  handle(CHANNELS.chartsCompare, (request: ChartsCompareRequest) =>
    provider.chartsCompare(request),
  )
  handle(CHANNELS.chartsRelationship, (request: ChartsRelationshipRequest) =>
    provider.chartsRelationship(request),
  )
  handle(CHANNELS.options, (request: OptionsRequest) => provider.options(request))
  handle(CHANNELS.targets, (request: TargetsRequest) => provider.targets(request))
  handle(CHANNELS.news, (request: NewsRequest) => provider.news(request))
  handle(CHANNELS.newsPage, (request: NewsPageRequest) =>
    provider.newsPage(request),
  )
  handle(CHANNELS.newsTickerSearch, (request: NewsTickerSearchRequest) =>
    provider.newsTickerSearch(request),
  )
  handle(CHANNELS.newsArticle, (request: NewsPreviewRequest) =>
    provider.newsArticle(request),
  )
  handle(CHANNELS.newsThumbnail, (request: NewsThumbnailRequest) =>
    provider.newsThumbnail(request),
  )
  handle(CHANNELS.fundamentals, (request: FundamentalsRequest) =>
    provider.fundamentals(request),
  )
  handle(CHANNELS.fundamentalsPage, (request: FundamentalsPageRequest) =>
    provider.fundamentalsPage(request),
  )
  handle(CHANNELS.returns, (request: ReturnsRequest) => provider.returns(request))
  handle(CHANNELS.momentum, (request: MomentumRequest) =>
    provider.momentum(request),
  )
  handle(CHANNELS.analytics, (request: AnalyticsRequest) =>
    provider.analytics(request),
  )
  handle(CHANNELS.optionQuotes, (request: OptionQuotesRequest) =>
    provider.optionQuotes(request),
  )
  handle(CHANNELS.portfolio, () => provider.portfolio())
  handle(CHANNELS.portfolioMutate, (mutation: PortfolioMutation) =>
    provider.mutatePortfolio(mutation),
  )
  handle(CHANNELS.cards, () => provider.cards())
  handle(CHANNELS.cardsMutate, (mutation: CardsMutation) =>
    provider.mutateCards(mutation),
  )
  handle(CHANNELS.cardsPerformance, (request: CardsPerformanceRequest) =>
    provider.cardsPerformance(request),
  )
  handle(CHANNELS.personalFinance, () => provider.personalFinance())
  handle(CHANNELS.personalFinanceMutate, (mutation: PersonalFinanceMutation) =>
    provider.mutatePersonalFinance(mutation),
  )
  handle(CHANNELS.fx, (request: FxRequest) => provider.fx(request))
  handle(CHANNELS.globalMarkets, (request: GlobalMarketsRequest) =>
    provider.globalMarkets(request),
  )

  handle(CHANNELS.preMarket, (request: PreMarketRequest) =>
    provider.preMarket(request),
  )
  handle(CHANNELS.tradingVolumes, (request: TradingVolumesRequest) =>
    provider.tradingVolumes(request),
  )
  handle(CHANNELS.signals, (request: SignalsRequest) =>
    provider.signals(request),
  )
  handle(CHANNELS.marketCapSales, (request: { symbols: string[]; force?: boolean }) => provider.marketCapSales(request))
  handle(CHANNELS.marketCap, (request: MarketCapRequest) => provider.marketCap(request)),
  handle(CHANNELS.priceScreen, (request: PriceScreenRequest) =>
    provider.priceScreen(request),
  )
  handle(CHANNELS.calendarMonth, (request: CalendarMonthRequest) =>
    provider.calendarMonth(request),
  )
  handle(CHANNELS.earningsCalendar, (request: EarningsCalendarRequest) =>
    provider.earningsCalendar(request),
  )
  handle(CHANNELS.crypto, (request: CryptoRequest) => provider.crypto(request))

  handle(CHANNELS.bitcoin, getBitcoin)
  handle(CHANNELS.bmnr, (request: BmnrRequest) => provider.bmnr(request))
  handle(CHANNELS.forexQuotes, getForexQuotes)
  handle(CHANNELS.forexHistory, getForexHistory)
  handle(CHANNELS.forexNews, getForexNews)
  handle(CHANNELS.sp500, (request: Sp500Request) => provider.sp500(request))
  handle(CHANNELS.sp500Breadth, (request: Sp500BreadthRequest) => provider.sp500Breadth(request))
  handle(CHANNELS.gold, (request: GoldRequest) => provider.gold(request))
  handle(CHANNELS.oil, (request: OilRequest) => provider.oil(request))
  handle(CHANNELS.heatmap, (request: HeatmapRequest) => provider.heatmap(request))
  handle(CHANNELS.etfHoldings, (request: EtfHoldingsRequest) =>
    provider.etfHoldings(request),
  )
  handle(CHANNELS.etfArbitrage, (request: EtfArbitrageRequest) =>
    provider.etfArbitrage(request),
  )
  handle(CHANNELS.etfAum, (request: EtfAumRequest) => provider.etfAum(request))
  handle(CHANNELS.upDown, (request: UpDownRequest) => provider.upDown(request))
  handle(CHANNELS.upDownTargets, (request: UpDownTargetsRequest) =>
    provider.upDownTargets(request),
  )
  handle(CHANNELS.valuation, (request: ValuationRequest) =>
    provider.valuation(request),
  )
  handle(CHANNELS.money, (request: MoneyRequest) => provider.money(request))
  handle(CHANNELS.economic, (request: EconomicRequest) =>
    provider.economic(request),
  )
  handle(CHANNELS.institutionActivity, (request: InstitutionActivityRequest) =>
    provider.institutionActivity(request),
  )
  handle(CHANNELS.institutionTickerActivity, (request: InstitutionTickerActivityRequest) =>
    provider.institutionTickerActivity(request),
  )
  handle(CHANNELS.roll, (request: RollRequest) => provider.roll(request))
  handle(CHANNELS.ipoUpcoming, (request: IpoUpcomingRequest) =>
    provider.ipoUpcoming(request),
  )
  handle(CHANNELS.ipoCompleted, (request: IpoCompletedRequest) =>
    provider.ipoCompleted(request),
  )
  handle(CHANNELS.politicsPage, (request: PoliticsPageRequest) =>
    provider.politicsPage(request),
  )
  handle(CHANNELS.politicsExport, (request: PoliticsExportRequest) =>
    provider.politicsExport(request),
  )
  handle(CHANNELS.stocks, (request: StocksRequest) => provider.stocks(request))
  handle(CHANNELS.optionsChain, (request: OptionsChainRequest) =>
    provider.optionsChain(request),
  )
  handle(CHANNELS.optionsExpirations, (request: OptionsExpirationsRequest) =>
    provider.optionsExpirations(request),
  )
  handle(CHANNELS.projections, (request: ProjectionsRequest) =>
    provider.projections(request),
  )
  handle(CHANNELS.backtest, (request: BacktestRequest) =>
    provider.backtest(request),
  )
  handle(CHANNELS.quantScan, (request: QuantScanRequest) =>
    provider.quantScan(request),
  )
  handle(CHANNELS.quantPair, (request: QuantPairRequest) =>
    provider.quantPair(request),
  )
  handle(CHANNELS.youtube, (request: YouTubeRequest) =>
    provider.youtube(request),
  )
  handle(CHANNELS.youtubeThumbnail, (request: YouTubeThumbnailRequest) =>
    provider.youtubeThumbnail(request),
  )
  handle(CHANNELS.settings, () => provider.settings())
  handle(CHANNELS.settingsMutate, (mutation: AppSettingsMutation) =>
    provider.mutateSettings(mutation),
  )

  /**
   * The User Data buttons. The renderer has already confirmed the destructive ones, so
   * all that is left here is resolving a path — dismissing the dialog is a normal
   * outcome and comes back as `performed: false`, not an error.
   */
  ipcMain.handle(
    CHANNELS.maintenance,
    async (event, action: MaintenanceAction): Promise<Envelope<MaintenanceResult>> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const cancelled = (message: string) =>
        ok({ action, performed: false, message, path: '' }, 'settings store')

      if (action === 'exportUserData') {
        const options = {
          title: 'Export User Data',
          defaultPath: `budget-terminal-backup-${new Date().toISOString().slice(0, 10)}.json`,
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showSaveDialog(window, options)
          : await dialog.showSaveDialog(options)
        if (result.canceled || !result.filePath) return cancelled('Export cancelled.')
        return provider.exportUserData(result.filePath)
      }

      if (action === 'importUserData') {
        const options = {
          title: 'Import User Data',
          properties: ['openFile' as const],
          filters: [{ name: 'JSON files', extensions: ['json'] }],
        }
        const result = window
          ? await dialog.showOpenDialog(window, options)
          : await dialog.showOpenDialog(options)
        const [selected] = result.filePaths
        if (result.canceled || !selected) return cancelled('Import cancelled.')
        return provider.importUserData(selected)
      }

      if (action === 'clearUserData') return provider.clearUserData()
      return provider.resetCache()
    },
  )

  ipcMain.handle(CHANNELS.openExternal, async (_event, url: string) => {
    if (!isSafeExternalUrl(url)) return
    await shell.openExternal(url)
  })

  ipcMain.handle(
    CHANNELS.saveText,
    async (event, suggestedName: string, contents: string): Promise<string | null> => {
      const window = BrowserWindow.fromWebContents(event.sender)
      const result = window
        ? await dialog.showSaveDialog(window, { defaultPath: suggestedName })
        : await dialog.showSaveDialog({ defaultPath: suggestedName })
      if (result.canceled || !result.filePath) return null
      await writeFile(result.filePath, contents, 'utf8')
      return result.filePath
    },
  )

  ipcMain.handle(CHANNELS.writeClipboard, (_event, contents: string) => {
    clipboard.writeText(contents)
  })

  ipcMain.handle(CHANNELS.windowControl, (event, action: WindowAction) => {
    const window = BrowserWindow.fromWebContents(event.sender)
    if (!window) return
    if (action === 'minimize') window.minimize()
    else if (action === 'close') window.close()
    else if (window.isMaximized()) window.unmaximize()
    else window.maximize()
  })

  const stopWatching = watchPortfolios(() => {
    for (const window of BrowserWindow.getAllWindows()) {
      window.webContents.send(CHANNELS.portfolioChanged)
    }
  })

  return () => {
    stopWatching()
    for (const channel of Object.values(CHANNELS)) ipcMain.removeHandler(channel)
  }
}
