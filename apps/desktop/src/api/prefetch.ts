import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { CARD_INTERVALS, type AppSettings, type PortfolioPayload } from '@shared/contract'
import { startupPages } from '@shared/navigation'
import { SP500_PARTS } from '@shared/sp500'
import { marketCapInTier } from '@shared/marketCap'
import { pickDiscoverySymbol } from '@shared/discovery'
import { normalizeBacktestPageSettings } from '@shared/backtest'
import { buildCardModels } from '@shared/cards'
import { useDataHealth, type StartupTiming } from '@/stores/dataHealth'
import { calendarToday, earningsDateRange } from '@shared/calendar'
import { useCalendarPage } from '@/stores/calendar'
import { useIpoPage } from '@/stores/ipo'
import { useFundamentalsStore } from '@/stores/fundamentals'
import { useStocksPage } from '@/stores/stocks'
import { useChartsStore } from '@/stores/charts'
import { useOptionsPage } from '@/stores/options'
import { useProjectionsPage } from '@/stores/projections'
import { useValuationPage } from '@/stores/valuation'
import { useDashboard } from '@/stores/dashboard'
import { useEtfPage } from '@/stores/etf'
import { useUpDownPage } from '@/stores/upDown'
import { api, queryKeys } from './client'
import { priceScreenKey } from './priceQueries'
import { backtestKey } from './backtestQueries'
import { cardsPerformanceKey } from './cardsQueries'
import { queryFreshness } from './queryPersistence'
import { usePortfolio } from './queries'
import { waitForWarmSlot, warmQuery } from './warmQueue'

/**
 * Load every implemented page's automatic initial data when the app opens.
 *
 * Most tasks fill the React Query cache under the exact keys their page hooks use,
 * so a warmed page mounts onto prepared data. Pages with manual local state also
 * read the startup snapshot when first opened.
 *
 * Two rules keep this from being a burst of hundreds of Yahoo calls:
 *
 * - a small worker pool prioritizes current/favorite/recent pages and yields to
 *   foreground requests between tasks, and
 * - provider requests still pass through the shared rate gate.
 *
 * It runs once per renderer session.
 */

interface WarmTask {
  tab: string
  label: string
  run: (client: QueryClient) => Promise<unknown>
}

export interface WarmProgress {
  active: boolean
  done: number
  total: number
  label: string
  failed: number
}

/** Heatmap is the slowest page; always warm it after every other background task. */
const LAST_BACKGROUND_PAGE = 'heatmap'

/** Background page priority; LAST_BACKGROUND_PAGE is pinned after even unlisted pages. */
const TAB_ORDER = [
  'dashboard',
  'portfolio',
  'news',
  'personal-finance',
  'global',
  'pre-market',
  'trading-volumes',
  'calendar',
  'stocks',
  'fundamentals',
  'cards',
  'forex',
  'crypto',
  'bmnr',
  'gold',
  'oil',
  'youtube',
  'etf',
  'economic',
  'money',
  'ipo',
  'up-down',
  'politics',
  'institutions',
]

/** The four different holding sets the pages ask for, from one document. */
function holdingsOf(payload: PortfolioPayload | undefined): {
  active: string[]
  every: string[]
  editable: string[]
  main: string[]
  upDown: string[]
} {
  const portfolios = payload?.portfolios ?? []
  const active = portfolios.find((entry) => entry.id === payload?.activeId) ?? portfolios[0] ?? null
  const main =
    portfolios.find((entry) => entry.id === payload?.mainId) ??
    portfolios.find((entry) => !entry.readOnly) ??
    null
  // `_get_fetch_tickers`: News fetches for every portfolio, not just the active one.
  const every = [
    ...new Set(portfolios.flatMap((entry) => entry.tickers.map((ticker) => ticker.toUpperCase()))),
  ]
  // Personal Finance skips the Combined aggregate, which would double every silo.
  const editable = [
    ...new Set(portfolios.filter((entry) => !entry.readOnly).flatMap((entry) => entry.tickers)),
  ]
  const upDown = active?.tickers.filter((ticker) => {
    const holding = active.holdings[ticker]
    return holding && holding.shares > 0 && holding.includeInWeight
  }) ?? []
  return { active: active?.tickers ?? [], every, editable, main: main?.tickers ?? [], upDown }
}

export function buildTasks(
  payload: PortfolioPayload | undefined,
  settings: AppSettings | undefined,
  symbols: { stocks: string; fundamentals: string },
  calendar: { year: number; month: number; earningsYear: number; ipoYear: number },
): WarmTask[] {
  const { active, every, editable, main, upDown } = holdingsOf(payload)
  const tasks: WarmTask[] = []

  const dashboard = useDashboard.getState()
  if (dashboard.symbol) {
    tasks.push({
      tab: 'dashboard', label: 'Dashboard chart',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.chart(dashboard.symbol, dashboard.timeframe),
        queryFn: () => api.chart({ symbol: dashboard.symbol, timeframe: dashboard.timeframe }),
        staleTime: queryFreshness(queryKeys.chart(dashboard.symbol, dashboard.timeframe)),
      }),
    })
    tasks.push({
      tab: 'dashboard', label: 'Dashboard options',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.options(dashboard.symbol),
        queryFn: () => api.options({ symbol: dashboard.symbol }),
        staleTime: queryFreshness(queryKeys.options(dashboard.symbol)),
      }),
    })
  }

  const dashboardBook = payload?.portfolios.find((entry) => entry.id === (dashboard.portfolioId ?? payload.activeId))
    ?? payload?.portfolios[0]
  const dashboardTickers = dashboardBook?.tickers ?? []
  if (dashboardTickers.length && dashboardTickers.join(',') !== active.join(',')) {
    tasks.push({
      tab: 'dashboard', label: 'Dashboard holdings',
      run: async (client) => {
        await warmQuery(client, {
          queryKey: queryKeys.quotes(dashboardTickers),
          queryFn: () => api.quotes({ holdings: dashboardTickers, background: true }),
          staleTime: queryFreshness(queryKeys.quotes(dashboardTickers)),
        })
        await warmQuery(client, {
          queryKey: queryKeys.targets(dashboardTickers),
          queryFn: () => api.targets({ tickers: dashboardTickers, background: true }),
          staleTime: queryFreshness(queryKeys.targets(dashboardTickers)),
        })
        await warmQuery(client, {
          queryKey: queryKeys.news(dashboardTickers),
          queryFn: () => api.news({ tickers: dashboardTickers, background: true }),
          staleTime: queryFreshness(queryKeys.news(dashboardTickers)),
        })
      },
    })
  }

  // Dashboard and Portfolio share the quote call for the active book.
  if (active.length) {
    tasks.push({
      tab: 'dashboard',
      label: 'Quotes',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.quotes(active),
          queryFn: () => api.quotes({ holdings: active, background: true }),
          staleTime: queryFreshness(queryKeys.quotes(active)),
        }),
    })
    tasks.push({
      tab: 'dashboard',
      label: 'Targets',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.targets(active),
          queryFn: () => api.targets({ tickers: active, background: true }),
          staleTime: queryFreshness(queryKeys.targets(active)),
        }),
    })
    tasks.push({
      tab: 'dashboard',
      label: 'Dashboard news',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.news(active),
          queryFn: () => api.news({ tickers: active, background: true }),
          staleTime: queryFreshness(queryKeys.news(active)),
        }),
    })
    tasks.push({
      tab: 'portfolio',
      label: 'Portfolio fundamentals',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.fundamentals(active),
          queryFn: () => api.fundamentals({ tickers: active, background: true }),
          staleTime: queryFreshness(queryKeys.fundamentals(active)),
        }),
    })
  }

  if (main.length && main.join(',') !== active.join(',')) {
    tasks.push({
      tab: 'backtest', label: 'Backtest quotes',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.quotes(main),
        queryFn: () => api.quotes({ holdings: main, background: true }),
        staleTime: queryFreshness(queryKeys.quotes(main)),
      }),
    })
  }

  const selectedBook = payload?.portfolios.find((entry) => entry.id === payload.activeId)
    ?? payload?.portfolios[0]
  const optionPositions = (selectedBook?.options ?? []).filter((option) => option.ticker).map((option) => ({
    rowId: option.rowId, ticker: option.ticker, expiry: option.expiry,
    strike: option.strike, strategy: option.strategy,
  }))
  if (optionPositions.length) {
    const signature = optionPositions
      .map((position) => `${position.rowId}:${position.ticker}:${position.expiry}:${position.strike}:${position.strategy}`)
      .join('|')
    tasks.push({
      tab: 'portfolio', label: 'Portfolio options',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.optionQuotes(signature),
        queryFn: () => api.optionQuotes({ positions: optionPositions }),
        staleTime: queryFreshness(queryKeys.optionQuotes(signature)),
      }),
    })
  }

  // Card performance uses the same model signature as the page's interval queries.
  tasks.push({
    tab: 'cards',
    label: 'Cards',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.cards,
        queryFn: () => api.cards(),
        staleTime: Infinity,
      }),
  })
  tasks.push({
    tab: 'cards', label: 'Card performance',
    run: async (client) => {
      const cards = await warmQuery(client, {
        queryKey: queryKeys.cards,
        queryFn: () => api.cards(),
        staleTime: Infinity,
      })
      const models = buildCardModels(cards.data, payload?.portfolios ?? [])
      if (!models.length) return
      for (const interval of CARD_INTERVALS) {
        const request = {
          interval,
          cards: models.map(({ id, symbols, weighting, weights, shares, cashBalance }) => ({
            id, symbols, weighting, weights, shares, cashBalance,
          })),
        }
        await warmQuery(client, {
          queryKey: cardsPerformanceKey(request),
          queryFn: () => api.cardsPerformance(request),
          staleTime: queryFreshness(cardsPerformanceKey(request)),
        })
      }
    },
  })

  tasks.push({
    tab: 'personal-finance',
    label: 'Personal Finance',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.personalFinance,
        queryFn: () => api.personalFinance(),
        staleTime: Infinity,
      }),
  })
  tasks.push({
    tab: 'personal-finance',
    label: 'FX rate',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.fx,
        queryFn: () => api.fx({ background: true }),
        staleTime: queryFreshness(queryKeys.fx),
      }),
  })
  if (editable.length) {
    tasks.push({
      tab: 'personal-finance',
      label: 'Brokerage quotes',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.quotes(editable),
          queryFn: () => api.quotes({ holdings: editable, background: true }),
          staleTime: queryFreshness(queryKeys.quotes(editable)),
        }),
    })
  }

  tasks.push({
    tab: 'global',
    label: 'Global markets',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.globalMarkets,
        queryFn: () => api.globalMarkets({ background: true }),
        staleTime: queryFreshness(queryKeys.globalMarkets),
      }),
  })

  tasks.push({
    tab: 'pre-market',
    label: 'Pre-Market',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.preMarket,
        queryFn: () => api.preMarket({ background: true }),
        staleTime: queryFreshness(queryKeys.preMarket),
      }),
  })

  const upDownPage = useUpDownPage.getState()
  const upDownSymbols = upDownPage.activeSource === 'portfolio' ? upDown
    : upDownPage.activeSource === 'custom' ? upDownPage.customSymbols : []
  tasks.push({
    tab: 'up-down', label: 'Up/Down',
    run: (client) => warmQuery(client, {
      queryKey: queryKeys.upDown(upDownPage.activeSource, upDownPage.interval, upDownSymbols),
      queryFn: () => api.upDown({
        source: upDownPage.activeSource, interval: upDownPage.interval,
        symbols: upDownSymbols, background: true,
      }),
      staleTime: queryFreshness(queryKeys.upDown(upDownPage.activeSource, upDownPage.interval, upDownSymbols)),
    }),
  })

  tasks.push({
    tab: 'calendar',
    label: 'Calendar month',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.calendarMonth(main, calendar.year, calendar.month),
        queryFn: () =>
          api.calendarMonth({
            tickers: main,
            year: calendar.year,
            month: calendar.month,
            background: true,
          }),
        staleTime: queryFreshness(queryKeys.calendarMonth(main, calendar.year, calendar.month)),
      }),
  })

  tasks.push({
    tab: 'politics',
    label: 'Politics',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.politicsPage(1),
        queryFn: () => api.politicsPage({ page: 1, background: true }),
        staleTime: queryFreshness(queryKeys.politicsPage(1)),
      }),
  })
  // The Earnings sub-tab opens on the whole current year. Its provider can remain
  // queued behind other startup requests longer than the usual background deadline.
  const earnings = earningsDateRange('year', calendar.earningsYear, calendarToday('local'))
  tasks.push({
    tab: 'calendar',
    label: 'Earnings calendar',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.earningsCalendar(earnings.rangeKey),
        queryFn: () =>
          api.earningsCalendar({
            startDate: earnings.startDate,
            endDate: earnings.endDate,
            rangeKey: earnings.rangeKey,
            background: true,
          }),
        staleTime: queryFreshness(queryKeys.earningsCalendar(earnings.rangeKey)),
      }, 180_000),
  })

  // The slowest load in the app cold — five government hosts, about 45s — and the one
  // with the most to gain: its six-hour disk cache means most warm-ups are nearly free.
  tasks.push({
    tab: 'money',
    label: 'Money',
    run: (client) => warmQuery(client, { queryKey: queryKeys.money, queryFn: () => api.money({ background: true }), staleTime: queryFreshness(queryKeys.money) }),
  })

  // The slowest load in the app cold — five government hosts, about 45s — and the one
  // with the most to gain: its six-hour disk cache means most warm-ups are nearly free.
  tasks.push({
    tab: 'economic',
    label: 'Economic',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.economic,
        queryFn: () => api.economic({ background: true }),
        staleTime: queryFreshness(queryKeys.economic),
      }),
  })

  // Two feeds, two keys, exactly as the page asks for them: a failed upcoming scrape must
  // not evict the completed rows.
  tasks.push({
    tab: 'ipo',
    label: 'Upcoming IPOs',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.ipoUpcoming,
        queryFn: () => api.ipoUpcoming({ background: true }),
        staleTime: queryFreshness(queryKeys.ipoUpcoming),
      }),
  })
  tasks.push({
    tab: 'ipo',
    label: 'Completed IPOs',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.ipoCompleted(calendar.ipoYear),
        queryFn: () => api.ipoCompleted({ year: calendar.ipoYear, background: true }),
        staleTime: queryFreshness(queryKeys.ipoCompleted(calendar.ipoYear)),
      }),
  })

  // The empty quarter is the latest one, which is what the page opens on.
  tasks.push({
    tab: 'institutions',
    label: 'Institutions',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.institutionActivity(''),
        queryFn: () => api.institutionActivity({ quarter: '', limit: 50, background: true }),
        staleTime: queryFreshness(queryKeys.institutionActivity('')),
      }),
  })

  if (symbols.stocks) {
    tasks.push({
      tab: 'stocks',
      label: `Stocks ${symbols.stocks}`,
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.stocks(symbols.stocks),
          queryFn: () => api.stocks({ symbol: symbols.stocks, background: true }),
          staleTime: queryFreshness(queryKeys.stocks(symbols.stocks)),
        }),
    })
  }
  if (symbols.fundamentals) {
    tasks.push({
      tab: 'fundamentals',
      label: `Fundamentals ${symbols.fundamentals}`,
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.fundamentalsPage(symbols.fundamentals),
          queryFn: () => api.fundamentalsPage({ symbol: symbols.fundamentals, background: true }),
          staleTime: queryFreshness(queryKeys.fundamentalsPage(symbols.fundamentals)),
        }),
    })
  }

  // The EIA weekly grid and the OPEC archive are long-cached in main and the dated futures
  // strip is thirteen paced requests, so warming this page is what keeps a first visit from
  // paying for all of it at once.
  tasks.push({
    tab: 'oil',
    label: 'Oil fundamentals',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.oil,
        queryFn: () => api.oil({ background: true }),
        staleTime: queryFreshness(queryKeys.oil),
      }),
  })

  if (every.length) {
    tasks.push({
      tab: 'news',
      label: 'News',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.newsPage(every),
          queryFn: () => api.newsPage({ tickers: every, background: true }),
          staleTime: queryFreshness(queryKeys.newsPage(every)),
        }),
    })
  }

  tasks.push({
    tab: 'forex',
    label: 'Forex quotes',
    run: (client) => warmQuery(client, { queryKey: queryKeys.forexQuotes, queryFn: () => api.forexQuotes({ background: true }), staleTime: queryFreshness(queryKeys.forexQuotes) }),
  })
  tasks.push({
    tab: 'forex',
    label: 'Forex history',
    run: (client) => warmQuery(client, { queryKey: queryKeys.forexHistory('EUR/USD', '1M'), queryFn: () => api.forexHistory({ pair: 'EUR/USD', range: '1M', background: true }), staleTime: queryFreshness(queryKeys.forexHistory('EUR/USD', '1M')) }),
  })
  tasks.push({
    tab: 'forex',
    label: 'Forex news',
    run: (client) => warmQuery(client, { queryKey: queryKeys.forexNews('EUR/USD'), queryFn: () => api.forexNews({ pair: 'EUR/USD', background: true }), staleTime: queryFreshness(queryKeys.forexNews('EUR/USD')) }),
  })

  // Three unrelated hosts and six Yahoo quotes; cheap next to Trading Volumes, but it is
  // the one page whose upstream (CoinGecko's free tier) rate-limits by the minute.
  tasks.push({
    tab: 'crypto',
    label: 'Crypto',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.crypto,
        queryFn: () => api.crypto({ background: true }),
        staleTime: queryFreshness(queryKeys.crypto),
      }),
  })

  // The AUM rail is the one request `init_page13` fires on mount; the holdings load
  // itself is a button, so it is deliberately not warmed.
  tasks.push({
    tab: 'etf',
    label: 'ETF AUM rail',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.etfAum,
        queryFn: () => api.etfAum({ background: true }),
        staleTime: queryFreshness(queryKeys.etfAum),
      }),
  })
  const etfTicker = useEtfPage.getState().ticker
  if (etfTicker) {
    tasks.push({
      tab: 'etf', label: `ETF ${etfTicker} holdings`,
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.etfHoldings(etfTicker),
        queryFn: () => api.etfHoldings({ ticker: etfTicker }),
        staleTime: queryFreshness(queryKeys.etfHoldings(etfTicker)),
      }),
    })
  }

  // One CoinGecko call, two SEC calls behind their own disk cache and three Yahoo quotes.
  tasks.push({
    tab: 'bmnr',
    label: 'BMNR treasury',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.bmnr,
        queryFn: () => api.bmnr({ background: true }),
        staleTime: queryFreshness(queryKeys.bmnr),
      }),
  })

  // Public WGC and USGS documents are long-cached in main; the two Yahoo proxy quotes
  // are the only fast-moving part of this fundamentals page.
  tasks.push({
    tab: 'gold',
    label: 'Gold fundamentals',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.gold,
        queryFn: () => api.gold({ background: true }),
        staleTime: queryFreshness(queryKeys.gold),
      }),
  })

  if (every.length) {
    // The same holdings set the News lane uses — the page unions every portfolio's tickers.
    tasks.push({
      tab: 'youtube',
      label: 'YouTube',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.youtube(every),
          queryFn: () => api.youtube({ tickers: every, background: true }),
          staleTime: queryFreshness(queryKeys.youtube(every)),
        }),
    })
  }

  // The default index only. Warming the other two would triple the cost for maps nobody
  // has asked to see, and the per-index cache makes switching to one free on the second
  // visit anyway.
  tasks.push({
    tab: 'heatmap',
    label: 'Heatmap',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.heatmap('SPY'),
        queryFn: () => api.heatmap({ etf: 'SPY', background: true }),
        staleTime: queryFreshness(queryKeys.heatmap('SPY')),
      }),
  })

  // A costly twelve-page screen plus a hundred daily charts, warmed before Heatmap.
  tasks.push({
    tab: 'trading-volumes',
    label: 'Trading Volumes',
    run: (client) =>
      warmQuery(client, {
        queryKey: queryKeys.tradingVolumes,
        queryFn: () => api.tradingVolumes({ background: true }),
        staleTime: queryFreshness(queryKeys.tradingVolumes),
      }),
  })

  const charts = useChartsStore.getState()
  tasks.push({
    tab: 'charts', label: 'Charts',
    run: (client) => warmQuery(client, {
      queryKey: queryKeys.chartsHistory(charts.symbol, charts.interval, charts.range),
      queryFn: () => api.chartsHistory({ symbol: charts.symbol, interval: charts.interval, range: charts.range }),
      staleTime: queryFreshness(queryKeys.chartsHistory(charts.symbol, charts.interval, charts.range)),
    }),
  })

  const valuation = useValuationPage.getState()
  if (valuation.ticker) {
    const peers = valuation.customPeersByTicker[valuation.ticker] ?? []
    tasks.push({
      tab: 'valuation', label: 'Valuation',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.valuation(valuation.ticker, peers),
        queryFn: () => api.valuation({ symbol: valuation.ticker, customPeers: peers }),
        staleTime: queryFreshness(queryKeys.valuation(valuation.ticker, peers)),
      }),
    })
  }

  const projections = useProjectionsPage.getState()
  if (projections.symbol) {
    tasks.push({
      tab: 'projections', label: 'Projections',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.projections(projections.symbol, projections.timeframe),
        queryFn: () => api.projections({ symbol: projections.symbol, timeframe: projections.timeframe }),
        staleTime: queryFreshness(queryKeys.projections(projections.symbol, projections.timeframe)),
      }),
    })
  }

  const options = useOptionsPage.getState()
  if (options.loaded && options.symbol) {
    tasks.push({
      tab: 'options', label: 'Options expirations',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.optionsExpirations(options.symbol),
        queryFn: () => api.optionsExpirations({ symbol: options.symbol }),
        staleTime: queryFreshness(queryKeys.optionsExpirations(options.symbol)),
      }),
    })
    tasks.push({
      tab: 'options', label: 'Options chain',
      run: (client) => warmQuery(client, {
        queryKey: queryKeys.optionsChain(options.symbol, options.expiry),
        queryFn: () => api.optionsChain({ symbol: options.symbol, expiry: options.expiry }),
        staleTime: queryFreshness(queryKeys.optionsChain(options.symbol, options.expiry)),
      }),
    })
  }

  tasks.push({
    tab: 'bitcoin', label: 'Bitcoin',
    run: (client) => warmQuery(client, {
      queryKey: queryKeys.bitcoin,
      queryFn: () => api.bitcoin({ background: true }),
      staleTime: queryFreshness(queryKeys.bitcoin),
    }),
  })
  tasks.push({
    tab: 'signals', label: 'Day Trading',
    run: (client) => warmQuery(client, {
      queryKey: queryKeys.signals,
      queryFn: () => api.signals({}),
      staleTime: 0,
    }),
  })
  tasks.push({
    tab: 'quant', label: 'Quant',
    run: (client) => warmQuery(client, {
      queryKey: queryKeys.quant,
      queryFn: () => api.quantScan({ latestOnly: true }),
      staleTime: queryFreshness(queryKeys.quant),
    }),
  })
  tasks.push({
    tab: 'technical-screen', label: 'Technical Indicators',
    run: (client) => warmQuery(client, {
      queryKey: queryKeys.technicalScreen,
      queryFn: () => api.technicalScan(),
      staleTime: queryFreshness(queryKeys.technicalScreen),
    }),
  })

  for (const part of SP500_PARTS) {
    tasks.push({
      tab: 'sp500', label: `S&P500 ${part}`,
      run: (client) => warmQuery(client, {
        queryKey: ['sp500', part],
        queryFn: () => api.sp500({ part, background: true }),
        staleTime: queryFreshness(['sp500', part]),
      }),
    })
  }
  tasks.push({
    tab: 'sp500', label: 'S&P500 breadth status',
    run: (client) => warmQuery(client, {
      queryKey: ['sp500Breadth'],
      queryFn: () => api.sp500Breadth({ action: 'status' }),
      staleTime: 30_000,
    }),
  })

  tasks.push({
    tab: 'market-cap', label: 'Market Cap',
    run: async (client) => {
      const result = await warmQuery(client, {
        queryKey: queryKeys.marketCap('all'),
        queryFn: async () => {
          const page = await api.marketCap({ tier: 'all' })
          if (page.data.rows.some((row) => !marketCapInTier(row.marketCap, 'all'))) {
            throw new Error('Market Cap returned rows outside the selected range.')
          }
          return page
        },
        staleTime: queryFreshness(queryKeys.marketCap('all')),
      })
      const symbols = result.data.rows.map((row) => row.ticker)
      if (symbols.length) await warmQuery(client, {
        queryKey: ['marketCapSales', [...symbols].sort().join(',')],
        queryFn: () => api.marketCapSales({ symbols }),
        staleTime: queryFreshness(['marketCapSales', [...symbols].sort().join(',')]),
      })
    },
  })

  const priceRequest = { minimumPrice: 100, maximumPrice: 200 }
  tasks.push({
    tab: 'price', label: 'Price',
    run: (client) => warmQuery(client, {
      queryKey: priceScreenKey(priceRequest),
      queryFn: () => api.priceScreen(priceRequest),
      staleTime: queryFreshness(priceScreenKey(priceRequest)),
    }),
  })

  tasks.push({
    tab: 'stock-discovery', label: 'Discovery',
    run: async (client) => {
      const universe = await warmQuery(client, {
        queryKey: ['discoveryUniverse'],
        queryFn: () => api.discoveryUniverse(),
        staleTime: queryFreshness(['discoveryUniverse']),
      })
      const symbol = pickDiscoverySymbol(universe.data.symbols, [])
      if (!symbol) throw new Error('The stock directory is empty.')
      await warmQuery(client, {
        queryKey: ['discoveryStartup'],
        queryFn: () => api.discovery({ symbol, background: true }),
        staleTime: queryFreshness(['discoveryStartup']),
      })
    },
  })

  const backtest = normalizeBacktestPageSettings(settings?.backtestPage)
  if (backtest.rows.some((row) => row.symbol && row.weight > 0)) {
    const request = {
      rows: backtest.rows,
      compareSymbol: backtest.compareSymbol,
      interval: backtest.interval,
      range: backtest.range,
    }
    tasks.push({
      tab: 'backtest', label: 'Backtest',
      run: (client) => warmQuery(client, {
        queryKey: backtestKey(request),
        queryFn: () => api.backtest(request),
        staleTime: queryFreshness(backtestKey(request)),
      }),
    })
  }

  const rank = (tab: string) => {
    if (tab === LAST_BACKGROUND_PAGE) return Infinity
    const index = TAB_ORDER.indexOf(tab)
    return index < 0 ? TAB_ORDER.length : index
  }
  return tasks.sort((a, b) => rank(a.tab) - rank(b.tab))
}

export function useWarmPages(settings: AppSettings | undefined, settingsSettled: boolean, activeTab: string, recent: string[]): WarmProgress {
  const queryClient = useQueryClient()
  const portfolioQuery = usePortfolio()

  const stocksSymbol = useStocksPage((state) => state.symbol)
  const fundamentalsSymbol = useFundamentalsStore((state) => state.symbol)
  const calendarYear = useCalendarPage((state) => state.year)
  const calendarMonth = useCalendarPage((state) => state.month)
  const earningsYear = useCalendarPage((state) => state.earningsYear)
  const ipoYear = useIpoPage((state) => state.completedYear)

  const [progress, setProgress] = useState<WarmProgress>({
    active: false,
    done: 0,
    total: 0,
    label: '',
    failed: 0,
  })

  // One warm-up per session, and it must survive StrictMode's double effect.
  const started = useRef(false)
  const payload = portfolioQuery.data?.data

  /**
   * Everything the task list is built from, read through a ref.
   *
   * The effect below used to list all of these as dependencies. The warm-up takes
   * minutes, and any of them changing inside that window — a portfolio edit, a Settings
   * toggle, typing a ticker into Stocks, paging the Calendar — ran the effect's cleanup,
   * which set `cancelled` and abandoned the warm-up part way through. The re-run then hit
   * the `started` guard and returned, so nothing ever restarted it: every page behind the
   * one being warmed at that moment silently went back to fetching on mount. Only
   * `ready` gates the effect now, and it flips false to true exactly once.
   */
  const inputs = useRef({
    activeTab, recent, favorites: settings?.favoriteTabs ?? [],
    payload,
    settings,
    stocksSymbol,
    fundamentalsSymbol,
    calendarYear,
    calendarMonth,
    earningsYear,
    ipoYear,
  })
  inputs.current = {
    activeTab, recent, favorites: settings?.favoriteTabs ?? [],
    payload,
    settings,
    stocksSymbol,
    fundamentalsSymbol,
    calendarYear,
    calendarMonth,
    earningsYear,
    ipoYear,
  }

  // A failed local read must not prevent unrelated pages from starting their loads.
  const readyRef = useRef(false)
  readyRef.current ||= settingsSettled && !portfolioQuery.isPending
  const ready = readyRef.current

  useEffect(() => {
    if (started.current || !ready) return
    const current = inputs.current
    const priority = startupPages(current.activeTab, current.favorites, current.recent)
    const tasks = buildTasks(
      current.payload,
      current.settings,
      { stocks: current.stocksSymbol, fundamentals: current.fundamentalsSymbol },
      {
        year: current.calendarYear,
        month: current.calendarMonth,
        earningsYear: current.earningsYear,
        ipoYear: current.ipoYear,
      },
    ).sort((a, b) => {
      const rank = (tab: string) => priority.indexOf(tab)
      return rank(a.tab) - rank(b.tab)
    })

    if (!tasks.length) {
      useDataHealth.getState().setStartup({ durationMs: 0, planned: 0, timings: [] })
      return
    }

    let cancelled = false
    // Defer startup so StrictMode's trial effect can clean up before marking this run
    // started. Otherwise the real effect skips a warm-up that was already cancelled.
    const run = async () => {
      started.current = true
      const startedAt = performance.now()
      const timings: StartupTiming[] = []
      let failedCount = 0
      let completed = 0
      let nextIndex = 0
      const activeLabels = new Set<string>()
      const report = () => useDataHealth.getState().setStartup({
        durationMs: performance.now() - startedAt, planned: tasks.length, timings: [...timings],
      })
      const reportProgress = () => setProgress({
        active: completed < tasks.length,
        done: completed,
        total: tasks.length,
        label: activeLabels.values().next().value ?? '',
        failed: failedCount,
      })
      report()
      reportProgress()
      const worker = async () => {
        while (!cancelled) {
          // Mounted queries get a head start, but polling cannot starve startup.
          await waitForWarmSlot({
            isHidden: () => false,
            isForegroundFetching: () => queryClient.isFetching({ type: 'active' }) > 0,
            isCancelled: () => cancelled,
          })
          if (cancelled) return
          const index = nextIndex++
          if (index >= tasks.length) return
          const task = tasks[index]
          activeLabels.add(task.label)
          reportProgress()
          const taskStarted = performance.now()
          let failed = false
          try {
            await task.run(queryClient)
          } catch (error) {
            failed = true
            failedCount += 1
            console.warn(`[warm-up] ${task.label}:`, error)
          }
          activeLabels.delete(task.label)
          completed += 1
          timings.push({ label: task.label, durationMs: performance.now() - taskStarted, failed })
          report()
          reportProgress()
          await new Promise((resolve) => setTimeout(resolve, 100))
        }
      }
      await Promise.all(Array.from({ length: Math.min(3, tasks.length) }, () => worker()))
    }
    const timer = setTimeout(() => void run(), 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ready, queryClient])

  return progress
}
