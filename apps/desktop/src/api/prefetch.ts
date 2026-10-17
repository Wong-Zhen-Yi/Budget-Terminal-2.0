import { useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import { CARD_INTERVALS, MACRO_SYMBOLS, type AppSettings, type PortfolioPayload } from '@shared/contract'
import { startupPages } from '@shared/navigation'
import { startupPageOrder } from '@shared/startupLoading'
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
import { useDefeatBetaTerminal } from '@/stores/defeatbeta'
import { DEFEATBETA_SECTIONS, TERMINAL_TTL } from '@shared/defeatbetaTerminal'
import { useStocksPage } from '@/stores/stocks'
import { useChartsStore } from '@/stores/charts'
import { useOptionsPage } from '@/stores/options'
import { useProjectionsPage } from '@/stores/projections'
import { useValuationPage } from '@/stores/valuation'
import { useDashboard } from '@/stores/dashboard'
import { useEtfPage } from '@/stores/etf'
import { useUpDownPage } from '@/stores/upDown'
import { useNewsPageStore } from '@/stores/news'
import { api, queryKeys } from './client'
import { priceScreenKey } from './priceQueries'
import { backtestKey } from './backtestQueries'
import { cardsPerformanceKey } from './cardsQueries'
import { queryFreshness } from './queryPersistence'
import { usePortfolio } from './queries'
import { assertStartupReady, runWarmTasks, StartupLoadError, warmStartupQuery, warmStartupSnapshot } from './warmQueue'
import { initialNewsImages, initialYouTubeVideo, newsQuoteTickers } from './initialContent'
import { loadAgents } from './agentsQueries'
import { errorMessage } from './snapshotHealth'
import { createProgressReporter } from './progressReporter'

/**
 * Load every implemented page's automatic initial data when the app opens.
 *
 * Most tasks fill the React Query cache under the exact keys their page hooks use,
 * so a warmed page mounts onto prepared data. Pages with manual local state also
 * read the startup snapshot when first opened.
 *
 * Every task starts together. After the first launch, observed page durations
 * order background provider requests from fastest to slowest. Provider
 * requests still pass through the shared rate gate in its background lane, so
 * parallel pages share one request budget and yield to foreground requests.
 *
 * It runs once per renderer session.
 */

interface WarmTask {
  tab: string
  label: string
  run: (client: QueryClient, backgroundOrder?: number) => Promise<unknown>
}

export interface WarmProgress {
  active: boolean
  done: number
  total: number
  label: string
  failed: number
  degraded: number
}

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
  const tasks: WarmTask[] = [{
    tab: 'agents', label: 'Agents workspace',
    run: client => warmStartupQuery(client, { queryKey: queryKeys.agents, queryFn: loadAgents, staleTime: Infinity }),
  }, {
    tab: 'articles', label: 'Articles library',
    run: client => warmStartupQuery(client, { queryKey: queryKeys.articles, queryFn: () => api.articles(), staleTime: Infinity }),
  }]
  const terminalSymbol = useDefeatBetaTerminal.getState().symbol
  for (const section of DEFEATBETA_SECTIONS) tasks.push({
    tab: 'defeatbeta', label: `DefeatBeta ${section}`,
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.defeatbetaTerminal(terminalSymbol, section),
      queryFn: () => api.defeatbetaTerminal({ symbol: terminalSymbol, section, background: true, backgroundOrder }),
      staleTime: TERMINAL_TTL,
    }),
  })

  const dashboard = useDashboard.getState()
  for (const { symbol, label } of MACRO_SYMBOLS) {
    tasks.push({
      tab: 'dashboard', label: `${label} sparkline`,
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.chart(symbol, '1 Day'),
        queryFn: () => api.chart({ symbol, timeframe: '1 Day', background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.chart(symbol, '1 Day')),
      }),
    })
  }
  if (dashboard.symbol) {
    tasks.push({
      tab: 'dashboard', label: 'Dashboard chart',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.chart(dashboard.symbol, dashboard.timeframe),
        queryFn: () => api.chart({ symbol: dashboard.symbol, timeframe: dashboard.timeframe, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.chart(dashboard.symbol, dashboard.timeframe)),
      }),
    })
    tasks.push({
      tab: 'dashboard', label: 'Dashboard options',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.options(dashboard.symbol),
        queryFn: () => api.options({ symbol: dashboard.symbol, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.options(dashboard.symbol)),
      }),
    })
  }

  const dashboardBook = payload?.portfolios.find((entry) => entry.id === (dashboard.portfolioId ?? payload.activeId))
    ?? payload?.portfolios[0]
  const dashboardTickers = dashboardBook?.tickers ?? []
  // The macro bar has quotes even when the saved holdings book is empty.
  if (!dashboardTickers.length) tasks.push({
    tab: 'dashboard', label: 'Macro quotes',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.quotes([]),
      queryFn: () => api.quotes({ holdings: [], background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.quotes([])),
    }),
  })
  if (dashboardTickers.length && dashboardTickers.join(',') !== active.join(',')) {
    tasks.push({
      tab: 'dashboard', label: 'Dashboard holdings',
      run: async (client, backgroundOrder) => {
        await warmStartupQuery(client, {
          queryKey: queryKeys.quotes(dashboardTickers),
          queryFn: () => api.quotes({ holdings: dashboardTickers, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.quotes(dashboardTickers)),
        })
        await warmStartupQuery(client, {
          queryKey: queryKeys.targets(dashboardTickers),
          queryFn: () => api.targets({ tickers: dashboardTickers, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.targets(dashboardTickers)),
        })
        await warmStartupQuery(client, {
          queryKey: queryKeys.news(dashboardTickers),
          queryFn: () => api.news({ tickers: dashboardTickers, background: true, backgroundOrder }),
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
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.quotes(active),
          queryFn: () => api.quotes({ holdings: active, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.quotes(active)),
        }),
    })
    tasks.push({
      tab: 'dashboard',
      label: 'Targets',
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.targets(active),
          queryFn: () => api.targets({ tickers: active, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.targets(active)),
        }),
    })
    tasks.push({
      tab: 'dashboard',
      label: 'Dashboard news',
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.news(active),
          queryFn: () => api.news({ tickers: active, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.news(active)),
        }),
    })
    tasks.push({
      tab: 'portfolio',
      label: 'Portfolio fundamentals',
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.fundamentals(active),
          queryFn: () => api.fundamentals({ tickers: active, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.fundamentals(active)),
        }),
    })
  }

  if (main.length && main.join(',') !== active.join(',')) {
    tasks.push({
      tab: 'backtest', label: 'Backtest quotes',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.quotes(main),
        queryFn: () => api.quotes({ holdings: main, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.quotes(main)),
      }),
    })
  }

  // Warm Dip Finder's default month return even before its Portfolio subtab is opened.
  if (upDown.length) tasks.push({
    tab: 'portfolio', label: 'Portfolio Dip Finder',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.returns(upDown, '1mo'),
      queryFn: () => api.returns({ tickers: upDown, window: '1mo', background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.returns(upDown, '1mo')),
    }),
  })

  const selectedBook = payload?.portfolios.find((entry) => entry.id === payload.activeId)
    ?? payload?.portfolios[0]
  const optionPositions = (selectedBook?.options ?? []).filter((option) => option.ticker).map((option) => ({
    rowId: option.rowId, ticker: option.ticker, expiry: option.expiry,
    strike: option.strike, strategy: option.strategy,
  }))
  const financeOptionPositions = (payload?.portfolios ?? []).filter(entry => !entry.readOnly).flatMap(entry =>
    (entry.options ?? []).map(option => ({
      rowId: `${entry.id}:${option.rowId}`, ticker: option.ticker, expiry: option.expiry,
      strike: option.strike, strategy: option.strategy,
    })),
  )
  for (const { tab, label, positions } of [
    { tab: 'portfolio', label: 'Portfolio options', positions: optionPositions },
    { tab: 'personal-finance', label: 'Personal Finance option marks', positions: financeOptionPositions },
  ]) {
    if (!positions.length) continue
    const signature = positions
      .map((position) => `${position.rowId}:${position.ticker}:${position.expiry}:${position.strike}:${position.strategy}`)
      .join('|')
    tasks.push({
      tab, label,
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.optionQuotes(signature),
        queryFn: () => api.optionQuotes({ positions, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.optionQuotes(signature)),
      }),
    })
  }

  // Card performance uses the same model signature as the page's interval queries.
  tasks.push({
    tab: 'cards',
    label: 'Cards',
    run: (client) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.cards,
        queryFn: () => api.cards(),
        staleTime: Infinity,
      }),
  })
  tasks.push({
    tab: 'cards', label: 'Card performance',
    run: async (client, backgroundOrder) => {
      const cards = await warmStartupQuery(client, {
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
        await warmStartupQuery(client, {
          queryKey: cardsPerformanceKey(request),
          queryFn: () => api.cardsPerformance({ ...request, background: true, backgroundOrder }),
          staleTime: queryFreshness(cardsPerformanceKey(request)),
        })
      }
    },
  })

  tasks.push({
    tab: 'personal-finance',
    label: 'Personal Finance',
    run: (client) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.personalFinance,
        queryFn: () => api.personalFinance(),
        staleTime: Infinity,
      }),
  })
  tasks.push({
    tab: 'personal-finance',
    label: 'FX rate',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.fx,
        queryFn: () => api.fx({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.fx),
      }),
  })
  if (editable.length) {
    tasks.push({
      tab: 'personal-finance',
      label: 'Brokerage quotes',
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.quotes(editable),
          queryFn: () => api.quotes({ holdings: editable, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.quotes(editable)),
        }),
    })
  }

  tasks.push({
    tab: 'global',
    label: 'Global markets',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.globalMarkets,
        queryFn: () => api.globalMarkets({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.globalMarkets),
      }),
  })

  tasks.push({
    tab: 'pre-market',
    label: 'Pre-Market',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.preMarket,
        queryFn: () => api.preMarket({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.preMarket),
      }),
  })

  const upDownPage = useUpDownPage.getState()
  const upDownSymbols = upDownPage.activeSource === 'portfolio' ? upDown
    : upDownPage.activeSource === 'custom' ? upDownPage.customSymbols : []
  tasks.push({
    tab: 'up-down', label: 'Up/Down',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.upDown(upDownPage.activeSource, upDownPage.interval, upDownSymbols),
      queryFn: () => api.upDown({
        source: upDownPage.activeSource, interval: upDownPage.interval,
        symbols: upDownSymbols, background: true, backgroundOrder,
      }),
      staleTime: queryFreshness(queryKeys.upDown(upDownPage.activeSource, upDownPage.interval, upDownSymbols)),
    }),
  })

  tasks.push({
    tab: 'calendar',
    label: 'Calendar month',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.calendarMonth(main, calendar.year, calendar.month),
        queryFn: () =>
          api.calendarMonth({
            tickers: main,
            year: calendar.year,
            month: calendar.month,
            background: true, backgroundOrder,
          }),
        staleTime: queryFreshness(queryKeys.calendarMonth(main, calendar.year, calendar.month)),
      }),
  })

  tasks.push({
    tab: 'politics',
    label: 'Politics',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.politicsPage(1),
        queryFn: () => api.politicsPage({ page: 1, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.politicsPage(1)),
      }),
  })
  // The Earnings sub-tab opens on the whole current year.
  const earnings = earningsDateRange('year', calendar.earningsYear, calendarToday('local'))
  tasks.push({
    tab: 'calendar',
    label: 'Earnings calendar',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.earningsCalendar(earnings.rangeKey),
        queryFn: () =>
          api.earningsCalendar({
            startDate: earnings.startDate,
            endDate: earnings.endDate,
            rangeKey: earnings.rangeKey,
            background: true, backgroundOrder,
          }),
        staleTime: queryFreshness(queryKeys.earningsCalendar(earnings.rangeKey)),
      }),
  })

  // The slowest load in the app cold — five government hosts, about 45s — and the one
  // with the most to gain: its six-hour disk cache means most warm-ups are nearly free.
  tasks.push({
    tab: 'money',
    label: 'Money',
    run: (client, backgroundOrder) => warmStartupQuery(client, { queryKey: queryKeys.money, queryFn: () => api.money({ background: true, backgroundOrder }), staleTime: queryFreshness(queryKeys.money) }),
  })

  // The slowest load in the app cold — five government hosts, about 45s — and the one
  // with the most to gain: its six-hour disk cache means most warm-ups are nearly free.
  tasks.push({
    tab: 'economic',
    label: 'Economic',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.economic,
        queryFn: () => api.economic({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.economic),
      }),
  })

  // Two feeds, two keys, exactly as the page asks for them: a failed upcoming scrape must
  // not evict the completed rows.
  tasks.push({
    tab: 'ipo',
    label: 'Upcoming IPOs',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.ipoUpcoming,
        queryFn: () => api.ipoUpcoming({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.ipoUpcoming),
      }),
  })
  tasks.push({
    tab: 'ipo',
    label: 'Completed IPOs',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.ipoCompleted(calendar.ipoYear),
        queryFn: () => api.ipoCompleted({ year: calendar.ipoYear, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.ipoCompleted(calendar.ipoYear)),
      }),
  })

  // The empty quarter is the latest one, which is what the page opens on.
  tasks.push({
    tab: 'institutions',
    label: 'Institutions',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.institutionActivity(''),
        queryFn: () => api.institutionActivity({ quarter: '', limit: 50, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.institutionActivity('')),
      }),
  })

  if (symbols.stocks) {
    tasks.push({
      tab: 'stocks',
      label: `Stocks ${symbols.stocks}`,
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.stocks(symbols.stocks),
          queryFn: () => api.stocks({ symbol: symbols.stocks, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.stocks(symbols.stocks)),
        }),
    })
  }
  if (symbols.fundamentals) {
    tasks.push({
      tab: 'fundamentals',
      label: `Fundamentals ${symbols.fundamentals}`,
      run: (client, backgroundOrder) =>
        warmStartupQuery(client, {
          queryKey: queryKeys.fundamentalsPage(symbols.fundamentals),
          queryFn: () => api.fundamentalsPage({ symbol: symbols.fundamentals, background: true, backgroundOrder }),
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
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.oil,
        queryFn: () => api.oil({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.oil),
      }),
  })

  if (every.length) {
    tasks.push({
      tab: 'news',
      label: 'News',
      run: async (client, backgroundOrder) => {
        const result = await warmStartupSnapshot(client, {
          queryKey: queryKeys.newsPage(every),
          queryFn: () => api.newsPage({ tickers: every, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.newsPage(every)),
        })
        const tickers = newsQuoteTickers(result.data.articles)
        const preferences = useNewsPageStore.getState()
        const requests: Array<Promise<unknown>> = []
        if (tickers.length) requests.push(warmStartupQuery(client, {
          queryKey: queryKeys.quotes(tickers),
          queryFn: () => api.quotes({ holdings: tickers, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.quotes(tickers)),
        }))
        if (preferences.showImages) for (const url of initialNewsImages(result.data.articles, preferences.filter, preferences.sort)) {
          requests.push(warmStartupQuery(client, {
            queryKey: queryKeys.newsThumbnail(url),
            queryFn: () => api.newsThumbnail({ url }), staleTime: Infinity,
          }))
        }
        const outcomes = await Promise.allSettled(requests)
        const failure = outcomes.find((entry) => entry.status === 'rejected' && !(entry.reason instanceof StartupLoadError && entry.reason.state === 'degraded'))
          ?? outcomes.find((entry) => entry.status === 'rejected')
        if (failure?.status === 'rejected') throw failure.reason
        assertStartupReady(result)
        return result
      },
    })
  }

  tasks.push({
    tab: 'forex',
    label: 'Forex quotes',
    run: (client, backgroundOrder) => warmStartupQuery(client, { queryKey: queryKeys.forexQuotes, queryFn: () => api.forexQuotes({ background: true, backgroundOrder }), staleTime: queryFreshness(queryKeys.forexQuotes) }),
  })
  tasks.push({
    tab: 'forex',
    label: 'Forex history',
    run: (client, backgroundOrder) => warmStartupQuery(client, { queryKey: queryKeys.forexHistory('EUR/USD', '1M'), queryFn: () => api.forexHistory({ pair: 'EUR/USD', range: '1M', background: true, backgroundOrder }), staleTime: queryFreshness(queryKeys.forexHistory('EUR/USD', '1M')) }),
  })
  tasks.push({
    tab: 'forex',
    label: 'Forex news',
    run: (client, backgroundOrder) => warmStartupQuery(client, { queryKey: queryKeys.forexNews('EUR/USD'), queryFn: () => api.forexNews({ pair: 'EUR/USD', background: true, backgroundOrder }), staleTime: queryFreshness(queryKeys.forexNews('EUR/USD')) }),
  })

  // Three unrelated hosts and six Yahoo quotes; cheap next to Trading Volumes, but it is
  // the one page whose upstream (CoinGecko's free tier) rate-limits by the minute.
  tasks.push({
    tab: 'crypto',
    label: 'Crypto',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.crypto,
        queryFn: () => api.crypto({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.crypto),
      }),
  })

  // The AUM rail is the one request `init_page13` fires on mount; the holdings load
  // itself is a button, so it is deliberately not warmed.
  tasks.push({
    tab: 'etf',
    label: 'ETF AUM rail',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.etfAum,
        queryFn: () => api.etfAum({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.etfAum),
      }),
  })
  const etfTicker = useEtfPage.getState().ticker
  if (etfTicker) {
    tasks.push({
      tab: 'etf', label: `ETF ${etfTicker} holdings`,
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.etfHoldings(etfTicker),
        queryFn: () => api.etfHoldings({ ticker: etfTicker, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.etfHoldings(etfTicker)),
      }),
    })
  }

  tasks.push({
    tab: 'amzn', label: 'AMZN company dashboard',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.amzn,
        queryFn: () => api.amzn({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.amzn),
      })
      if (result.meta.freshness === 'partial' || result.meta.freshness === 'stale') {
        throw new Error(result.meta.failureReason || 'AMZN startup data is incomplete')
      }
      return result
    },
  })
  tasks.push({
    tab: 'mu', label: 'MU company dashboard',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.mu,
        queryFn: () => api.mu({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.mu),
      })
      // Retain usable panels, while keeping incomplete startup visible in progress.
      if (result.meta.freshness === 'partial' || result.meta.freshness === 'stale') {
        throw new Error(result.meta.failureReason || 'MU startup data is incomplete')
      }
      return result
    },
  })
  tasks.push({
    tab: 'avgo', label: 'AVGO company dashboard',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.avgo,
        queryFn: () => api.avgo({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.avgo),
      })
      // Retain usable panels, while keeping incomplete startup visible in progress.
      if (result.meta.freshness === 'partial' || result.meta.freshness === 'stale') {
        throw new Error(result.meta.failureReason || 'AVGO startup data is incomplete')
      }
      return result
    },
  })
  tasks.push({
    tab: 'semiconductors', label: 'Semiconductor supply chain',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.semiconductors,
      queryFn: () => api.semiconductors({ background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.semiconductors),
    }),
  })
  tasks.push({
    tab: 'vst', label: 'VST company dashboard',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.vst,
        queryFn: () => api.vst({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.vst),
      })
      // Retain usable panels, while keeping incomplete startup visible in progress.
      if (result.meta.freshness === 'partial' || result.meta.freshness === 'stale') {
        throw new Error(result.meta.failureReason || 'VST startup data is incomplete')
      }
      return result
    },
  })
  tasks.push({
    tab: 'sofi', label: 'SOFI company dashboard',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.sofi,
        queryFn: () => api.sofi({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.sofi),
      })
      // Keep usable panels cached, but report incomplete startup as a visible failure.
      if (result.meta.freshness === 'partial' || result.meta.freshness === 'stale') {
        throw new Error(result.meta.failureReason || 'SOFI startup data is incomplete')
      }
      return result
    },
  })
  tasks.push({
    tab: 'hims', label: 'HIMS company dashboard',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.hims,
        queryFn: () => api.hims({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.hims),
      })
      if (result.meta.freshness === 'partial' || result.meta.freshness === 'stale') {
        throw new Error(result.meta.failureReason || 'HIMS startup data is incomplete')
      }
      return result
    },
  })
  tasks.push({
    tab: 'hood', label: 'HOOD company dashboard',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.hood,
      queryFn: () => api.hood({ background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.hood),
    }),
  })
  tasks.push({
    tab: 'pltr', label: 'PLTR market, chart and news',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.stocks('PLTR'),
      queryFn: () => api.stocks({ symbol: 'PLTR', background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.stocks('PLTR')),
    }),
  }, {
    tab: 'pltr', label: 'PLTR financials and filings',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.fundamentalsPage('PLTR'),
      queryFn: () => api.fundamentalsPage({ symbol: 'PLTR', background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.fundamentalsPage('PLTR')),
    }),
  })

  // One CoinGecko call, two SEC calls behind their own disk cache and three Yahoo quotes.
  tasks.push({
    tab: 'bmnr',
    label: 'BMNR treasury',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.bmnr,
        queryFn: () => api.bmnr({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.bmnr),
      }),
  })

  // Public WGC and USGS documents are long-cached in main; the two Yahoo proxy quotes
  // are the only fast-moving part of this fundamentals page.
  tasks.push({
    tab: 'gold',
    label: 'Gold fundamentals',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.gold,
        queryFn: () => api.gold({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.gold),
      }),
  })

  if (every.length) {
    // The same holdings set the News lane uses — the page unions every portfolio's tickers.
    tasks.push({
      tab: 'youtube',
      label: 'YouTube',
      run: async (client, backgroundOrder) => {
        const result = await warmStartupSnapshot(client, {
          queryKey: queryKeys.youtube(every),
          queryFn: () => api.youtube({ tickers: every, background: true, backgroundOrder }),
          staleTime: queryFreshness(queryKeys.youtube(every)),
        })
        const selected = initialYouTubeVideo(result.data.items, settings?.youtubePage)
        if (selected && (selected.videoId || selected.thumbnailUrl)) await warmStartupQuery(client, {
          queryKey: queryKeys.youtubeThumbnail(selected.videoId, selected.thumbnailUrl),
          queryFn: () => api.youtubeThumbnail({ videoId: selected.videoId, thumbnailUrl: selected.thumbnailUrl }),
          staleTime: Infinity,
        })
        assertStartupReady(result)
        return result
      },
    })
  }

  // The default index only. Warming the other two would triple the cost for maps nobody
  // has asked to see, and the per-index cache makes switching to one free on the second
  // visit anyway.
  tasks.push({
    tab: 'heatmap',
    label: 'Heatmap',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.heatmap('SPY'),
        queryFn: () => api.heatmap({ etf: 'SPY', background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.heatmap('SPY')),
      }),
  })

  // A costly twelve-page screen plus a hundred daily charts, sharing the Yahoo gate.
  tasks.push({
    tab: 'trading-volumes',
    label: 'Trading Volumes',
    run: (client, backgroundOrder) =>
      warmStartupQuery(client, {
        queryKey: queryKeys.tradingVolumes,
        queryFn: () => api.tradingVolumes({ background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.tradingVolumes),
      }),
  })

  const charts = useChartsStore.getState()
  tasks.push({
    tab: 'charts', label: 'Charts',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.chartsHistory(charts.symbol, charts.interval, charts.range),
      queryFn: () => api.chartsHistory({ symbol: charts.symbol, interval: charts.interval, range: charts.range, background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.chartsHistory(charts.symbol, charts.interval, charts.range)),
    }),
  })

  const valuation = useValuationPage.getState()
  if (valuation.ticker) {
    const peers = valuation.customPeersByTicker[valuation.ticker] ?? []
    tasks.push({
      tab: 'valuation', label: 'Valuation',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.valuation(valuation.ticker, peers),
        queryFn: () => api.valuation({ symbol: valuation.ticker, customPeers: peers, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.valuation(valuation.ticker, peers)),
      }),
    })
  }

  const projections = useProjectionsPage.getState()
  if (projections.symbol) {
    tasks.push({
      tab: 'projections', label: 'Projections',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.projections(projections.symbol, projections.timeframe),
        queryFn: () => api.projections({ symbol: projections.symbol, timeframe: projections.timeframe, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.projections(projections.symbol, projections.timeframe)),
      }),
    })
  }

  const options = useOptionsPage.getState()
  if (options.loaded && options.symbol) {
    tasks.push({
      tab: 'options', label: 'Options expirations',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.optionsExpirations(options.symbol),
        queryFn: () => api.optionsExpirations({ symbol: options.symbol, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.optionsExpirations(options.symbol)),
      }),
    })
    tasks.push({
      tab: 'options', label: 'Options chain',
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: queryKeys.optionsChain(options.symbol, options.expiry),
        queryFn: () => api.optionsChain({ symbol: options.symbol, expiry: options.expiry, background: true, backgroundOrder }),
        staleTime: queryFreshness(queryKeys.optionsChain(options.symbol, options.expiry)),
      }),
    })
  }

  tasks.push({
    tab: 'bitcoin', label: 'Bitcoin',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.bitcoin,
      queryFn: () => api.bitcoin({ background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.bitcoin),
    }),
  })
  tasks.push({
    tab: 'quant', label: 'Quant',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.quant,
      queryFn: () => api.quantScan({ latestOnly: true, background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.quant),
    }),
  })
  tasks.push({
    tab: 'technical-screen', label: 'Technical Indicators',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: queryKeys.technicalScreen,
      queryFn: () => api.technicalScan({ background: true, backgroundOrder }),
      staleTime: queryFreshness(queryKeys.technicalScreen),
    }),
  })

  for (const part of SP500_PARTS) {
    tasks.push({
      tab: 'sp500', label: `S&P500 ${part}`,
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: ['sp500', part],
        queryFn: () => api.sp500({ part, background: true, backgroundOrder }),
        staleTime: queryFreshness(['sp500', part]),
      }),
    })
  }
  tasks.push({
    tab: 'sp500', label: 'S&P500 breadth status',
    run: (client) => warmStartupQuery(client, {
      queryKey: ['sp500Breadth'],
      queryFn: () => api.sp500Breadth({ action: 'status' }),
      staleTime: 30_000,
    }),
  })

  tasks.push({
    tab: 'market-cap', label: 'Market Cap',
    run: async (client, backgroundOrder) => {
      const result = await warmStartupQuery(client, {
        queryKey: queryKeys.marketCap('all'),
        queryFn: async () => {
          const page = await api.marketCap({ tier: 'all', background: true, backgroundOrder })
          if (page.data.rows.some((row) => !marketCapInTier(row.marketCap, 'all'))) {
            throw new Error('Market Cap returned rows outside the selected range.')
          }
          return page
        },
        staleTime: queryFreshness(queryKeys.marketCap('all')),
      })
      const symbols = result.data.rows.map((row) => row.ticker)
      if (symbols.length) await warmStartupQuery(client, {
        queryKey: ['marketCapSales', [...symbols].sort().join(',')],
        queryFn: () => api.marketCapSales({ symbols, background: true, backgroundOrder }),
        staleTime: queryFreshness(['marketCapSales', [...symbols].sort().join(',')]),
      })
    },
  })

  const priceRequest = { minimumPrice: 100, maximumPrice: 200 }
  tasks.push({
    tab: 'price', label: 'Price',
    run: (client, backgroundOrder) => warmStartupQuery(client, {
      queryKey: priceScreenKey(priceRequest),
      queryFn: () => api.priceScreen({ ...priceRequest, background: true, backgroundOrder }),
      staleTime: queryFreshness(priceScreenKey(priceRequest)),
    }),
  })

  tasks.push({
    tab: 'stock-discovery', label: 'Discovery',
    run: async (client, backgroundOrder) => {
      const universe = await warmStartupQuery(client, {
        queryKey: ['discoveryUniverse'],
        queryFn: () => api.discoveryUniverse(),
        staleTime: queryFreshness(['discoveryUniverse']),
      })
      const symbol = pickDiscoverySymbol(universe.data.symbols, [])
      if (!symbol) throw new Error('The stock directory is empty.')
      await warmStartupQuery(client, {
        queryKey: ['discoveryStartup'],
        queryFn: () => api.discovery({ symbol, background: true, backgroundOrder }),
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
      run: (client, backgroundOrder) => warmStartupQuery(client, {
        queryKey: backtestKey(request),
        queryFn: () => api.backtest({ ...request, background: true, backgroundOrder }),
        staleTime: queryFreshness(backtestKey(request)),
      }),
    })
  }

  return tasks
}

export function useWarmPages(settings: AppSettings | undefined, settingsSettled: boolean, activeTab: string, recent: string[], settingsError?: unknown): WarmProgress {
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
    degraded: 0,
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
    settingsError,
    portfolioError: portfolioQuery.error ?? (portfolioQuery.data?.meta.freshness === 'failed' ? portfolioQuery.data.meta.failureReason || 'Holdings could not load' : undefined),
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
    settingsError,
    portfolioError: portfolioQuery.error ?? (portfolioQuery.data?.meta.freshness === 'failed' ? portfolioQuery.data.meta.failureReason || 'Holdings could not load' : undefined),
  }

  // A failed local read must not prevent unrelated pages from starting their loads.
  const readyRef = useRef(false)
  readyRef.current ||= settingsSettled && !portfolioQuery.isPending
  const ready = readyRef.current

  useEffect(() => {
    if (started.current || !ready) return
    // Calendar's persisted timezone selects its civil date. Initialize it before
    // warming keys, so its first mount cannot move to a different month/year.
    const calendarState = useCalendarPage.getState()
    calendarState.initialize(calendarToday(calendarState.timezone))
    const initializedCalendar = useCalendarPage.getState()
    const currentIpoYear = new Date().getFullYear()
    if (useIpoPage.getState().completedYear !== currentIpoYear) useIpoPage.getState().setCompletedYear(currentIpoYear)
    const current = inputs.current
    const priority = startupPageOrder(
      startupPages(current.activeTab, current.favorites, current.recent),
      useDataHealth.getState().startupLoads,
    )
    const tasks = buildTasks(
      current.payload,
      current.settings,
      { stocks: current.stocksSymbol, fundamentals: current.fundamentalsSymbol },
      {
        year: initializedCalendar.year,
        month: initializedCalendar.month,
        earningsYear: initializedCalendar.earningsYear,
        ipoYear: currentIpoYear,
      },
    ).sort((a, b) => {
      const rank = (tab: string) => priority.indexOf(tab)
      return rank(a.tab) - rank(b.tab)
    })

    if (!tasks.length) {
      useDataHealth.getState().setStartup({ durationMs: 0, planned: 0, timings: [] })
      return
    }

    const pageOrder = priority
    const pageRanks = new Map(pageOrder.map((page, index) => [page, index]))
    let cancelled = false
    let reporter: ReturnType<typeof createProgressReporter> | undefined
    // Defer startup so StrictMode's trial effect can clean up before marking this run
    // started. Otherwise the real effect skips a warm-up that was already cancelled.
    const run = async () => {
      started.current = true
      const startedAt = performance.now()
      const timings: StartupTiming[] = []
      let failedCount = 0
      let degradedCount = 0
      let completed = 0
      const activeLabels = new Set<string>()
      const taskStarts = new Map<WarmTask, number>()
      const pages: NonNullable<NonNullable<ReturnType<typeof useDataHealth.getState>['startup']>['pages']> = Object.fromEntries(pageOrder.map((page) => [page, {
        state: tasks.some((task) => task.tab === page) ? 'loading' as const
          : ['options', 'news', 'youtube', 'valuation', 'backtest', 'stocks', 'fundamentals', 'projections'].includes(page) ? 'idle' as const : 'ready' as const,
        reason: tasks.some((task) => task.tab === page) ? undefined
          : page === 'beta' ? 'Shares Trading Volumes startup data'
          : ['options', 'news', 'youtube', 'valuation', 'backtest', 'stocks', 'fundamentals', 'projections'].includes(page) ? 'Awaiting configured inputs'
          : 'Local or shared initial state',
      }]))
      for (const [page, error] of [['settings', current.settingsError], ['portfolio', current.portfolioError]] as const) {
        if (!error) continue
        pages[page] = { state: 'failed', reason: errorMessage(error) }
        failedCount += 1
      }
      const report = () => useDataHealth.getState().setStartup({
        durationMs: performance.now() - startedAt, planned: tasks.length, timings: [...timings], pageOrder, pages: { ...pages },
      })
      const reportProgress = () => setProgress({
        active: completed < tasks.length,
        done: completed,
        total: tasks.length,
        label: activeLabels.values().next().value ?? '',
        failed: failedCount,
        degraded: degradedCount,
      })
      reporter = createProgressReporter(() => {
        report()
        reportProgress()
      })
      reporter.flush()
      await runWarmTasks(tasks, {
        run: (task) => task.run(queryClient, pageRanks.get(task.tab)),
        isCancelled: () => cancelled,
        onStart: (task) => {
          activeLabels.add(task.label)
          taskStarts.set(task, performance.now())
          reporter!.schedule()
        },
        onSettled: (task, result) => {
          const state = result.status === 'fulfilled' ? 'ready' : result.reason instanceof StartupLoadError && result.reason.state === 'degraded' ? 'degraded' : 'failed'
          const failed = state === 'failed'
          const reason = result.status === 'rejected' ? errorMessage(result.reason) : undefined
          if (state === 'degraded') degradedCount += 1
          if (failed) {
            failedCount += 1
            console.warn(`[warm-up] ${task.label}:`, reason)
          }
          activeLabels.delete(task.label)
          completed += 1
          timings.push({ tab: task.tab, label: task.label, durationMs: performance.now() - taskStarts.get(task)!, failed, state, reason })
          const pageTimings = timings.filter((entry) => entry.tab === task.tab)
          if (pageTimings.length === tasks.filter((entry) => entry.tab === task.tab).length) {
            const worst = pageTimings.find((entry) => entry.state === 'failed') ?? pageTimings.find((entry) => entry.state === 'degraded')
            if (!(task.tab === 'portfolio' && current.portfolioError)) {
              pages[task.tab] = { state: worst?.state ?? 'ready', reason: worst?.reason }
            }
            if (task.tab === 'trading-volumes') pages.beta = { ...pages[task.tab], reason: worst?.reason ?? 'Shares Trading Volumes startup data' }
            useDataHealth.getState().recordStartupLoad(
              task.tab, Math.max(...pageTimings.map((entry) => entry.durationMs)),
              pageTimings.some((entry) => entry.state !== 'ready'),
            )
          }
          // Keep accounting exact, but publish bursts at most ten times a second.
          // Flush completion immediately so readiness never waits on the timer.
          if (completed === tasks.length) reporter!.flush()
          else reporter!.schedule()
        },
      })
    }
    const timer = setTimeout(() => void run(), 250)

    return () => {
      cancelled = true
      reporter?.cancel()
      clearTimeout(timer)
    }
  }, [ready, queryClient])

  return progress
}
