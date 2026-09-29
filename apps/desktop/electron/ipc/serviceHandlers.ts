import { getBitcoin } from '../services/bitcoin.js'
import type { Sp500Request, Sp500BreadthRequest } from '../shared/sp500.js'

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
  DiscoveryRequest,
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
  YouTubeRequest,
  YouTubeThumbnailRequest,
} from '../shared/contract.js'
import { getForexQuotes, getForexHistory, getForexNews } from '../services/forex.js'
import { CHANNELS } from '../shared/contract.js'
import { yahooProvider } from '../services/provider.js'
import { runWithPriority } from '../services/yahoo/client.js'
import { getApiUsageSnapshot } from '../services/apiUsage.js'

export type RegisterService = <Request>(channel: string, run: (request: Request) => unknown) => void

/** Register provider routes for Electron IPC. */
export function registerServiceHandlers(register: RegisterService): void {
  const provider = yahooProvider

  register(CHANNELS.apiUsage, () => getApiUsageSnapshot())

  /**
   * Register a provider channel in the rate gate lane its request asks for.
   *
   * The warm-up sets `background: true` (see `BackgroundRequest` in the contract), and
   * `runWithPriority` puts the whole fan-out that handler starts — however many awaits
   * deep — into the background lane. Everything else is foreground, which is what makes a
   * page the user just opened jump the warm-up's queue. Transport-specific maintenance
   * and shell actions are registered separately by each host.
   */
  const handle = <Request>(channel: string, run: (request: Request) => unknown): void => {
    register(channel, (request: Request) =>
      runWithPriority(
        (request as { background?: boolean } | undefined)?.background
          ? 'background'
          : 'foreground',
        async () => run(request),
        (request as { backgroundOrder?: number } | undefined)?.backgroundOrder,
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
  handle(CHANNELS.technicalScan, () => provider.technicalScan())
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
  handle(CHANNELS.discoveryUniverse, () => provider.discoveryUniverse())
  handle(CHANNELS.discovery, (request: DiscoveryRequest) => provider.discovery(request))
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

}
