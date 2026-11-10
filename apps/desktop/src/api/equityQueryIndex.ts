import type { Query, QueryClient } from '@tanstack/react-query'
import type { EquityMarketUpdate } from '@shared/contract'

const companyRoots = new Set(['amzn', 'avgo', 'mu', 'sofi', 'vst', 'hood', 'hims', 'pltr'])
const symbolRoots = new Set(['chart', 'chartsHistory', 'stocks', 'fundamentalsPage'])

/** Maintain membership on cache changes; market ticks never enumerate unrelated queries. */
export function createEquityQueryIndex(client: QueryClient) {
  const symbols = new Map<string, Set<Query>>()
  const memberships = new Map<Query, { data: unknown; symbols: Set<string> }>()
  const crypto = new Set<Query>()
  function remove(query: Query) {
    for (const symbol of memberships.get(query)?.symbols ?? []) {
      const queries = symbols.get(symbol)
      queries?.delete(query)
      if (!queries?.size) symbols.delete(symbol)
    }
    memberships.delete(query)
    crypto.delete(query)
  }
  function register(query: Query) {
    if (memberships.get(query)?.data === query.state.data) return
    const data = (query.state.data as { data?: Record<string, unknown> } | undefined)?.data
    const root = String(query.queryKey[0])
    const next = new Set<string>()
    if (data) {
      if (root === 'quotes') Object.keys(data.holdings ?? {}).forEach(symbol => next.add(symbol))
      else if (root === 'crypto') Object.keys(data.quotes ?? {}).forEach(symbol => next.add(symbol))
      else if (root === 'chartsCompare') Object.keys(data.series ?? {}).forEach(symbol => next.add(symbol))
      else if (root === 'marketCap' || root === 'priceScreen') {
        for (const row of data.rows as Array<{ ticker: string }> ?? []) next.add(row.ticker)
      } else if (root === 'heatmap') {
        for (const row of data.holdings as Array<{ symbol: string }> ?? []) next.add(row.symbol)
      } else if (root === 'semiconductors') {
        for (const row of data.rows as Array<{ company: { symbol: string } }> ?? []) next.add(row.company.symbol)
      } else if (root === 'bmnr') next.add('BMNR')
      else if (root === 'valuation' && typeof data.ticker === 'string') next.add(data.ticker)
      else if (symbolRoots.has(root) && typeof data.symbol === 'string') next.add(data.symbol)
      else if (companyRoots.has(root)) {
        const market = data.market as { symbol?: string } | undefined
        if (market?.symbol) next.add(market.symbol)
      }
    }
    remove(query)
    // Unrelated query results do not need identities retained in this index.
    if (!next.size && root !== 'crypto') return
    memberships.set(query, { data: query.state.data, symbols: next })
    if (root === 'crypto') crypto.add(query)
    for (const symbol of next) {
      const queries = symbols.get(symbol) ?? new Set<Query>()
      queries.add(query)
      symbols.set(symbol, queries)
    }
  }
  const cache = client.getQueryCache()
  cache.getAll().forEach(register)
  const stop = cache.subscribe(event => {
    if (event.type === 'removed') remove(event.query)
    else if (event.type === 'added' || event.type === 'updated') register(event.query)
  })
  return {
    matching(update: EquityMarketUpdate): Set<Query> {
      const queries = new Set<Query>(update.hyperliquid ? crypto : [])
      for (const item of [...update.quotes, ...update.candles]) {
        for (const query of symbols.get(item.symbol) ?? []) queries.add(query)
      }
      return queries
    },
    stop() { stop(); symbols.clear(); memberships.clear(); crypto.clear() },
  }
}
