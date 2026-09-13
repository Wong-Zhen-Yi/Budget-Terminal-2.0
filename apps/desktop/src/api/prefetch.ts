import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { AppSettings, PortfolioPayload } from '@shared/contract'
import { calendarToday, earningsDateRange } from '@shared/calendar'
import { useCalendarPage } from '@/stores/calendar'
import { useIpoPage } from '@/stores/ipo'
import { useFundamentalsStore } from '@/stores/fundamentals'
import { useStocksPage } from '@/stores/stocks'
import { api, queryKeys } from './client'
import { queryFreshness } from './queryPersistence'
import { usePortfolio } from './queries'
import { waitForWarmSlot, warmQuery } from './warmQueue'

/**
 * Warm every page's data at startup, so switching tabs lands on a loaded page instead of
 * a spinner.
 *
 * The pages themselves are untouched: this only fills the React Query cache under the
 * exact keys and `staleTime`s their own hooks use, so a warmed page mounts straight onto
 * cached data without going back to the network. A page whose warm-up failed simply
 * fetches on mount, as it always did.
 *
 * Two rules keep this from being a burst of hundreds of Yahoo calls:
 *
 * - the tasks run strictly one after another in the configured page priority order,
 *   yielding to foreground requests between tasks, and
 * - hidden tabs are skipped — a page taken out of the strip in Settings has no reason to
 *   spend the rate budget.
 *
 * It runs once per session. Reload (F5) still refetches what is mounted; it does not
 * re-run the warm-up.
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

function buildTasks(
  payload: PortfolioPayload | undefined,
  symbols: { stocks: string; fundamentals: string },
  calendar: { year: number; month: number; earningsYear: number; ipoYear: number },
): WarmTask[] {
  const { active, every, editable, main, upDown } = holdingsOf(payload)
  const tasks: WarmTask[] = []

  // Dashboard and Portfolio share the quote call for the active book. The Dashboard's
  // chart and option buckets are keyed by its own stored symbol and are left to it.
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

  // The card definitions are a local store read, so this only removes the mount spinner.
  // The performance sweep is left to the page: its key is a signature over the models it
  // builds from the definitions and the holdings, which cannot be reproduced here.
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

  if (upDown.length) {
    tasks.push({
      tab: 'up-down',
      label: 'Up/Down',
      run: (client) =>
        warmQuery(client, {
          queryKey: queryKeys.upDown('portfolio', '1d', upDown),
          queryFn: () => api.upDown({ source: 'portfolio', interval: '1d', symbols: upDown, background: true }),
          staleTime: queryFreshness(queryKeys.upDown('portfolio', '1d', upDown)),
        }),
    })
  }

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
  // The Earnings sub-tab opens on the whole current year, `earningsDateRange('year', ...)`.
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
      }),
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

  const rank = (tab: string) => {
    if (tab === LAST_BACKGROUND_PAGE) return Infinity
    const index = TAB_ORDER.indexOf(tab)
    return index < 0 ? TAB_ORDER.length : index
  }
  return tasks.sort((a, b) => rank(a.tab) - rank(b.tab))
}

export function useWarmPages(settings: AppSettings | undefined): WarmProgress {
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
  })

  const hidden = useMemo(() => new Set(settings?.hiddenTabs ?? []), [settings])
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
    payload,
    hidden,
    stocksSymbol,
    fundamentalsSymbol,
    calendarYear,
    calendarMonth,
    earningsYear,
    ipoYear,
  })
  inputs.current = {
    payload,
    hidden,
    stocksSymbol,
    fundamentalsSymbol,
    calendarYear,
    calendarMonth,
    earningsYear,
    ipoYear,
  }

  // Wait for the holdings document — nearly every task keys off it — and for Settings,
  // which says which pages are worth warming at all.
  const readyRef = useRef(false)
  readyRef.current ||= Boolean(payload && settings)
  const ready = readyRef.current

  useEffect(() => {
    if (started.current || !ready) return
    const current = inputs.current
    const tasks = buildTasks(
      current.payload,
      { stocks: current.stocksSymbol, fundamentals: current.fundamentalsSymbol },
      {
        year: current.calendarYear,
        month: current.calendarMonth,
        earningsYear: current.earningsYear,
        ipoYear: current.ipoYear,
      },
    ).filter((task) =>
      task.tab === 'economic'
        // Bonds and Economic share the same rates payload. Warm it whenever either page
        // is visible, but still skip the long provider load when both are hidden.
        ? !(current.hidden.has('economic') && current.hidden.has('bonds'))
        : !current.hidden.has(task.tab),
    )

    if (!tasks.length) return

    let cancelled = false
    // Defer startup so StrictMode's trial effect can clean up before marking this run
    // started. Otherwise the real effect skips a warm-up that was already cancelled.
    const run = async () => {
      started.current = true
      for (const [index, task] of tasks.entries()) {
        // Give mounted queries a head start, bounded so polling or a stuck foreground
        // request cannot starve warm-up. Main's rate gate still prioritizes foreground.
        await waitForWarmSlot({
          isHidden: () => document.hidden,
          isForegroundFetching: () => queryClient.isFetching({ type: 'active' }) > 0,
          isCancelled: () => cancelled,
        })
        if (cancelled) return
        const hiddenNow = inputs.current.hidden
        if (task.tab === 'economic'
          ? hiddenNow.has('economic') && hiddenNow.has('bonds')
          : hiddenNow.has(task.tab)) continue
        setProgress({ active: true, done: index, total: tasks.length, label: task.label })
        // A page that cannot be warmed is not an error here: it falls back to fetching
        // when the user opens it, exactly as it did before.
        try {
          await task.run(queryClient)
        } catch (error) {
          console.warn(`[warm-up] ${task.label}:`, error)
        }
        // Yield between pages so navigation and its foreground queries can start.
        await new Promise((resolve) => setTimeout(resolve, 250))
      }
      if (!cancelled) {
        setProgress({ active: false, done: tasks.length, total: tasks.length, label: '' })
      }
    }
    const timer = setTimeout(() => void run(), 250)

    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [ready, queryClient])

  return progress
}
