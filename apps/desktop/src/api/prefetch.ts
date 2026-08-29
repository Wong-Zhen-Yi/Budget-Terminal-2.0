import { useEffect, useMemo, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import type { AppSettings, PortfolioPayload } from '@shared/contract'
import { calendarToday, earningsDateRange } from '@shared/calendar'
import { useCalendarPage } from '@/stores/calendar'
import { useFundamentalsStore } from '@/stores/fundamentals'
import { useStocksPage } from '@/stores/stocks'
import { api, queryKeys } from './client'
import { FX_REFRESH_MS, PRE_MARKET_REFRESH_MS, QUOTE_REFRESH_MS } from './refreshRates'

/** `_P17_REFRESH_TTL_SECONDS`, and what `useHeatmap` uses as its own `staleTime`. */
const HEATMAP_STALE_MS = 120_000
import { usePortfolio } from './queries'

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
 * - the tasks run strictly one after another, cheapest pages first, so whichever tab is
 *   on screen finishes long before Trading Volumes starts, and
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

/** Cheapest pages first, so the heavy two are what is left running in the background. */
const TAB_ORDER = [
  'dashboard',
  'portfolio',
  'personal-finance',
  'global',
  'pre-market',
  'up-down',
  'calendar',
  'stocks',
  'fundamentals',
  'news',
  'crypto',
  'heatmap',
  'trading-volumes',
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
  calendar: { year: number; month: number; earningsYear: number },
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
        client.prefetchQuery({
          queryKey: queryKeys.quotes(active),
          queryFn: () => api.quotes({ holdings: active }),
          staleTime: QUOTE_REFRESH_MS / 2,
        }),
    })
    tasks.push({
      tab: 'dashboard',
      label: 'Targets',
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.targets(active),
          queryFn: () => api.targets({ tickers: active }),
          staleTime: Infinity,
        }),
    })
    tasks.push({
      tab: 'dashboard',
      label: 'Dashboard news',
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.news(active),
          queryFn: () => api.news({ tickers: active }),
          staleTime: Infinity,
        }),
    })
    tasks.push({
      tab: 'portfolio',
      label: 'Portfolio fundamentals',
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.fundamentals(active),
          queryFn: () => api.fundamentals({ tickers: active }),
          staleTime: Infinity,
        }),
    })
  }

  tasks.push({
    tab: 'personal-finance',
    label: 'Personal Finance',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.personalFinance,
        queryFn: () => api.personalFinance(),
        staleTime: Infinity,
      }),
  })
  tasks.push({
    tab: 'personal-finance',
    label: 'FX rate',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.fx,
        queryFn: () => api.fx({}),
        staleTime: FX_REFRESH_MS / 2,
      }),
  })
  if (editable.length) {
    tasks.push({
      tab: 'personal-finance',
      label: 'Brokerage quotes',
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.quotes(editable),
          queryFn: () => api.quotes({ holdings: editable }),
          staleTime: QUOTE_REFRESH_MS / 2,
        }),
    })
  }

  tasks.push({
    tab: 'global',
    label: 'Global markets',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.globalMarkets,
        queryFn: () => api.globalMarkets({}),
        staleTime: Infinity,
      }),
  })

  tasks.push({
    tab: 'pre-market',
    label: 'Pre-Market',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.preMarket,
        queryFn: () => api.preMarket({}),
        staleTime: PRE_MARKET_REFRESH_MS / 2,
      }),
  })

  if (upDown.length) {
    tasks.push({
      tab: 'up-down',
      label: 'Up/Down',
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.upDown('portfolio', '1d', upDown),
          queryFn: () => api.upDown({ source: 'portfolio', interval: '1d', symbols: upDown }),
          staleTime: Infinity,
        }),
    })
  }

  tasks.push({
    tab: 'calendar',
    label: 'Calendar month',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.calendarMonth(main, calendar.year, calendar.month),
        queryFn: () =>
          api.calendarMonth({ tickers: main, year: calendar.year, month: calendar.month }),
        staleTime: Infinity,
      }),
  })
  // The Earnings sub-tab opens on the whole current year, `earningsDateRange('year', ...)`.
  const earnings = earningsDateRange('year', calendar.earningsYear, calendarToday('local'))
  tasks.push({
    tab: 'calendar',
    label: 'Earnings calendar',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.earningsCalendar(earnings.rangeKey),
        queryFn: () =>
          api.earningsCalendar({
            startDate: earnings.startDate,
            endDate: earnings.endDate,
            rangeKey: earnings.rangeKey,
          }),
        staleTime: Infinity,
      }),
  })

  if (symbols.stocks) {
    tasks.push({
      tab: 'stocks',
      label: `Stocks ${symbols.stocks}`,
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.stocks(symbols.stocks),
          queryFn: () => api.stocks({ symbol: symbols.stocks }),
          staleTime: Infinity,
        }),
    })
  }
  if (symbols.fundamentals) {
    tasks.push({
      tab: 'fundamentals',
      label: `Fundamentals ${symbols.fundamentals}`,
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.fundamentalsPage(symbols.fundamentals),
          queryFn: () => api.fundamentalsPage({ symbol: symbols.fundamentals }),
          staleTime: Infinity,
        }),
    })
  }

  if (every.length) {
    tasks.push({
      tab: 'news',
      label: 'News',
      run: (client) =>
        client.prefetchQuery({
          queryKey: queryKeys.newsPage(every),
          queryFn: () => api.newsPage({ tickers: every }),
          staleTime: Infinity,
        }),
    })
  }

  // Three unrelated hosts and six Yahoo quotes; cheap next to Trading Volumes, but it is
  // the one page whose upstream (CoinGecko's free tier) rate-limits by the minute.
  tasks.push({
    tab: 'crypto',
    label: 'Crypto',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.crypto,
        queryFn: () => api.crypto({}),
        staleTime: Infinity,
      }),
  })

  // The default index only. Warming the other two would triple the cost for maps nobody
  // has asked to see, and the per-index cache makes switching to one free on the second
  // visit anyway.
  tasks.push({
    tab: 'heatmap',
    label: 'Heatmap',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.heatmap('SPY'),
        queryFn: () => api.heatmap({ etf: 'SPY' }),
        staleTime: HEATMAP_STALE_MS,
      }),
  })

  // Last, and by a wide margin the most expensive: a twelve-page screen plus a hundred
  // daily charts, roughly half a minute behind the rate gate.
  tasks.push({
    tab: 'trading-volumes',
    label: 'Trading Volumes',
    run: (client) =>
      client.prefetchQuery({
        queryKey: queryKeys.tradingVolumes,
        queryFn: () => api.tradingVolumes({}),
        staleTime: Infinity,
      }),
  })

  const rank = (tab: string) => {
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

  useEffect(() => {
    // Wait for the holdings document — nearly every task keys off it — and for Settings,
    // which says which pages are worth warming at all.
    if (started.current || !payload || !settings) return
    started.current = true

    const tasks = buildTasks(
      payload,
      { stocks: stocksSymbol, fundamentals: fundamentalsSymbol },
      { year: calendarYear, month: calendarMonth, earningsYear },
    ).filter((task) => !hidden.has(task.tab))

    if (!tasks.length) return

    let cancelled = false
    void (async () => {
      for (const [index, task] of tasks.entries()) {
        if (cancelled) return
        setProgress({ active: true, done: index, total: tasks.length, label: task.label })
        // A page that cannot be warmed is not an error here: it falls back to fetching
        // when the user opens it, exactly as it did before.
        try {
          await task.run(queryClient)
        } catch {
          /* the page reports its own failure when it mounts */
        }
      }
      if (!cancelled) {
        setProgress({ active: false, done: tasks.length, total: tasks.length, label: '' })
      }
    })()

    return () => {
      cancelled = true
    }
  }, [
    payload,
    settings,
    hidden,
    queryClient,
    stocksSymbol,
    fundamentalsSymbol,
    calendarYear,
    calendarMonth,
    earningsYear,
  ])

  return progress
}
