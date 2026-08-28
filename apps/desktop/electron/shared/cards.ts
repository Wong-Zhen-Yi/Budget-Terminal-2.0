import type {
  CardInterval,
  CardPerformance,
  CardPerformanceInput,
  CardResolvedWeighting,
  CardsPayload,
  CustomCard,
  Portfolio,
} from './contract.js'

export const CARDS_VERSION = 2
export const STARTER_CARDS_VERSION = 1
export const BUILTIN_INDEX_CARD_ID = 'builtin:index'

export const STARTER_CUSTOM_CARDS: ReadonlyArray<CustomCard> = [
  {
    id: 'custom:starter_balanced_core',
    name: 'Balanced Core',
    symbols: ['SPY', 'BND', 'GLD'],
    weighting: 'custom',
    weights: { SPY: 60, BND: 30, GLD: 10 },
  },
  {
    id: 'custom:starter_growth_hedge',
    name: 'Growth & Hedge',
    symbols: ['SPY', 'TLT', 'GLD'],
    weighting: 'custom',
    weights: { SPY: 50, TLT: 25, GLD: 25 },
  },
  {
    id: 'custom:starter_three_way_equal',
    name: 'Three-Way Equal',
    symbols: ['SPY', 'IEF', 'GLD'],
    weighting: 'equal',
    weights: {},
  },
]

export interface CardModel extends CardPerformanceInput {
  type: 'builtin' | 'portfolio' | 'custom'
  name: string
  portfolioId?: string
  metaPrefix: string
  meta: string
  actionLabel: string
}

export interface CardPriceSeries {
  timestamps: number[]
  values: number[]
}

export type CardDropSide = 'before' | 'after'

export function reorderCardIds(
  visibleIds: string[],
  persistedOrder: string[],
  draggedId: string,
  targetId: string,
  side: CardDropSide,
): string[] {
  if (draggedId === targetId || !visibleIds.includes(draggedId)) return [...persistedOrder]
  const nextVisible = visibleIds.filter((id) => id !== draggedId)
  const targetIndex = nextVisible.indexOf(targetId)
  if (targetIndex < 0) return [...persistedOrder]
  nextVisible.splice(targetIndex + (side === 'after' ? 1 : 0), 0, draggedId)
  return [
    ...nextVisible,
    ...persistedOrder.filter((id) => !nextVisible.includes(id)),
  ]
}

export function normalizeCardSymbols(values: unknown): string[] {
  const raw = typeof values === 'string'
    ? values.split(/[\s,;]+/)
    : Array.isArray(values)
      ? values
      : []
  const symbols: string[] = []
  for (const value of raw) {
    const symbol = String(value ?? '').trim().toUpperCase()
    if (symbol && symbol !== 'CASH' && !symbols.includes(symbol)) symbols.push(symbol)
  }
  return symbols
}

export function normalizeCardWeights(
  symbols: unknown,
  values: unknown,
): Record<string, number> {
  const source = values && typeof values === 'object' ? values as Record<string, unknown> : {}
  const raw: Record<string, number> = {}
  for (const symbol of normalizeCardSymbols(symbols)) {
    const candidate = Number(source[symbol] ?? source[symbol.toLowerCase()] ?? 0)
    if (Number.isFinite(candidate) && candidate > 0) raw[symbol] = candidate
  }
  const total = Object.values(raw).reduce((sum, value) => sum + value, 0)
  if (total <= 0) return {}
  return Object.fromEntries(
    Object.entries(raw).map(([symbol, value]) => [symbol, (value / total) * 100]),
  )
}

export function normalizeCustomCard(value: unknown): CustomCard | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const symbols = normalizeCardSymbols(raw.symbols)
  const id = String(raw.id ?? '').trim()
  if (!symbols.length || !id.startsWith('custom:')) return null
  let weighting = raw.weighting === 'custom' ? 'custom' as const : 'equal' as const
  let weights = weighting === 'custom' ? normalizeCardWeights(symbols, raw.weights) : {}
  if (weighting === 'custom' && !Object.keys(weights).length) {
    weighting = 'equal'
    weights = {}
  }
  return {
    id,
    name: (String(raw.name ?? '').trim() || 'Untitled Strategy').slice(0, 80),
    symbols,
    weighting,
    weights,
  }
}

function uniqueStrings(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  const result: string[] = []
  for (const entry of value) {
    const text = String(entry ?? '').trim()
    if (text && !result.includes(text)) result.push(text)
  }
  return result
}

export function normalizeCardsPayload(value: unknown, sourcePath = ''): CardsPayload {
  const raw = value && typeof value === 'object' ? value as Record<string, unknown> : {}
  const rawCards = raw.customCards ?? raw.custom_cards
  const customCards: CustomCard[] = []
  const customIds = new Set<string>()
  if (Array.isArray(rawCards)) {
    for (const entry of rawCards) {
      const card = normalizeCustomCard(entry)
      if (!card || customIds.has(card.id)) continue
      customCards.push(card)
      customIds.add(card.id)
    }
  }

  let starterCardsVersion = Number(
    raw.starterCardsVersion ?? raw.starter_cards_version ?? 0,
  )
  if (!Number.isFinite(starterCardsVersion)) starterCardsVersion = 0
  if (starterCardsVersion < STARTER_CARDS_VERSION) {
    for (const starter of STARTER_CUSTOM_CARDS) {
      if (customIds.has(starter.id)) continue
      customCards.push({ ...starter, symbols: [...starter.symbols], weights: { ...starter.weights } })
      customIds.add(starter.id)
    }
    starterCardsVersion = STARTER_CARDS_VERSION
  }

  const cardOrder = uniqueStrings(raw.cardOrder ?? raw.card_order)
  if (!cardOrder.includes(BUILTIN_INDEX_CARD_ID)) cardOrder.unshift(BUILTIN_INDEX_CARD_ID)
  for (const card of customCards) if (!cardOrder.includes(card.id)) cardOrder.push(card.id)

  const intervals: Record<string, CardInterval> = {}
  const rawIntervals = raw.intervals
  if (rawIntervals && typeof rawIntervals === 'object') {
    for (const [id, interval] of Object.entries(rawIntervals)) {
      if (interval === '1d' || interval === '30d' || interval === '1y') intervals[id] = interval
    }
  }

  return {
    version: CARDS_VERSION,
    starterCardsVersion,
    customCards,
    cardOrder,
    hiddenPortfolioIds: uniqueStrings(raw.hiddenPortfolioIds ?? raw.hidden_portfolio_ids),
    intervals,
    sourcePath,
  }
}

export function defaultCardsPayload(sourcePath = ''): CardsPayload {
  return normalizeCardsPayload({
    starterCardsVersion: STARTER_CARDS_VERSION,
    customCards: STARTER_CUSTOM_CARDS,
    cardOrder: [BUILTIN_INDEX_CARD_ID, ...STARTER_CUSTOM_CARDS.map((card) => card.id)],
    hiddenPortfolioIds: [],
    intervals: {},
  }, sourcePath)
}

export function buildCardModels(state: CardsPayload, portfolios: Portfolio[]): CardModel[] {
  const models: CardModel[] = [{
    id: BUILTIN_INDEX_CARD_ID,
    type: 'builtin',
    name: 'Index',
    symbols: ['SPY'],
    weighting: 'custom',
    weights: { SPY: 100 },
    shares: {},
    cashBalance: 0,
    metaPrefix: 'Default basket | SPY 100%',
    meta: 'Default basket | SPY 100%',
    actionLabel: 'Open Basket',
  }]

  for (const portfolio of portfolios.filter((entry) => !entry.readOnly)) {
    const symbols: string[] = []
    const shares: Record<string, number> = {}
    for (const symbol of normalizeCardSymbols(portfolio.tickers)) {
      const holding = portfolio.holdings[symbol]
        ?? Object.values(portfolio.holdings).find((entry) => entry.ticker.toUpperCase() === symbol)
      if (holding?.includeInWeight === false) continue
      symbols.push(symbol)
      if (holding && holding.shares > 0) shares[symbol] = holding.shares
    }
    models.push({
      id: `portfolio:${portfolio.id}`,
      portfolioId: portfolio.id,
      type: 'portfolio',
      name: portfolio.name || 'Portfolio',
      symbols,
      weighting: 'portfolio',
      weights: {},
      shares,
      cashBalance: Math.max(portfolio.cashBalance || 0, 0),
      metaPrefix: `Portfolio basket | ${symbols.length} holdings`,
      meta: `Portfolio basket | ${symbols.length} holdings | actual weights`,
      actionLabel: 'Open Basket',
    })
  }

  for (const card of state.customCards) {
    const weightingLabel = card.weighting === 'custom' ? 'Custom weights' : 'Equal weight'
    models.push({
      ...card,
      type: 'custom',
      shares: {},
      cashBalance: 0,
      metaPrefix: `Starter/custom basket | ${card.symbols.length} holdings`,
      meta: `Starter/custom basket | ${card.symbols.length} holdings | ${weightingLabel}`,
      actionLabel: 'Edit Basket',
    })
  }

  const byId = new Map(models.map((model) => [model.id, model]))
  const hidden = new Set(state.hiddenPortfolioIds.map((id) => `portfolio:${id}`))
  const ordered: string[] = []
  for (const id of state.cardOrder) {
    if (byId.has(id) && !hidden.has(id) && !ordered.includes(id)) ordered.push(id)
  }
  for (const model of models) {
    if (!hidden.has(model.id) && !ordered.includes(model.id)) ordered.push(model.id)
  }
  return ordered.flatMap((id) => {
    const model = byId.get(id)
    return model ? [model] : []
  })
}

function positiveRecord(values: Record<string, number> | undefined): Record<string, number> {
  return Object.fromEntries(
    Object.entries(values ?? {}).filter(([, value]) => Number.isFinite(value) && value > 0),
  )
}

export function computeCardPerformance(
  input: CardPerformanceInput,
  seriesBySymbol: Record<string, CardPriceSeries>,
  interval: CardInterval,
): CardPerformance {
  const normalized: Record<string, CardPriceSeries> = {}
  const latest: Record<string, number> = {}
  for (const symbol of normalizeCardSymbols(input.symbols)) {
    const series = seriesBySymbol[symbol]
    if (!series) continue
    const points = series.timestamps
      .map((timestamp, index) => ({ timestamp, value: series.values[index] }))
      .filter((point) => Number.isFinite(point.timestamp) && Number.isFinite(point.value) && point.value > 0)
      .sort((a, b) => a.timestamp - b.timestamp)
    const deduped = new Map(points.map((point) => [point.timestamp, point.value]))
    const timestamps = [...deduped.keys()]
    const values = [...deduped.values()]
    if (values.length < 2) continue
    const first = values[0]
    normalized[symbol] = {
      timestamps,
      values: values.map((value) => value / first - 1),
    }
    latest[symbol] = values[values.length - 1]
  }
  const includedSymbols = normalizeCardSymbols(input.symbols).filter((symbol) => normalized[symbol])
  if (!includedSymbols.length) throw new Error('No usable price history was returned for this basket.')

  let weighting: CardResolvedWeighting = input.weighting
  let rawWeights: Record<string, number> = {}
  if (input.weighting === 'custom') {
    const configured = positiveRecord(input.weights)
    rawWeights = Object.fromEntries(
      includedSymbols.flatMap((symbol) => configured[symbol] ? [[symbol, configured[symbol]]] : []),
    )
  } else if (input.weighting === 'portfolio') {
    const shares = positiveRecord(input.shares)
    rawWeights = Object.fromEntries(
      includedSymbols.flatMap((symbol) => {
        const value = (shares[symbol] ?? 0) * latest[symbol]
        return value > 0 ? [[symbol, value]] : []
      }),
    )
    if (Object.keys(rawWeights).length && input.cashBalance > 0) rawWeights.CASH = input.cashBalance
    if (!Object.keys(rawWeights).length) weighting = 'equal_fallback'
  } else {
    weighting = 'equal'
  }
  if (!Object.keys(rawWeights).length) {
    rawWeights = Object.fromEntries(includedSymbols.map((symbol) => [symbol, 1]))
    if (weighting !== 'equal_fallback') weighting = 'equal'
  }
  const totalWeight = Object.values(rawWeights).reduce((sum, value) => sum + value, 0)
  const resolved = Object.fromEntries(
    Object.entries(rawWeights).map(([symbol, value]) => [symbol, value / totalWeight]),
  )

  const timestamps = [...new Set(
    includedSymbols.flatMap((symbol) => normalized[symbol].timestamps),
  )].sort((a, b) => a - b)
  const positions = Object.fromEntries(includedSymbols.map((symbol) => [symbol, 0]))
  const lastValues: Record<string, number> = {}
  const values: number[] = []
  for (const timestamp of timestamps) {
    for (const symbol of includedSymbols) {
      const series = normalized[symbol]
      let position = positions[symbol]
      while (position < series.timestamps.length && series.timestamps[position] <= timestamp) {
        lastValues[symbol] = series.values[position]
        position += 1
      }
      positions[symbol] = position
    }
    const available = includedSymbols.filter((symbol) => lastValues[symbol] !== undefined)
    if (available.length) {
      values.push(available.reduce(
        (sum, symbol) => sum + lastValues[symbol] * (resolved[symbol] ?? 0),
        0,
      ) * 100)
    }
  }
  if (values.length < 2) throw new Error('Not enough price history was returned for this basket.')

  const weightingLabels: Record<CardResolvedWeighting, string> = {
    equal: 'Equal weight',
    custom: 'Custom weights',
    portfolio: 'Actual portfolio weights',
    equal_fallback: 'Equal weight fallback',
  }
  return {
    values,
    returnPct: values[values.length - 1],
    points: values.length,
    includedSymbols,
    missingSymbols: normalizeCardSymbols(input.symbols).filter((symbol) => !includedSymbols.includes(symbol)),
    weights: Object.fromEntries(
      Object.entries(resolved).map(([symbol, value]) => [symbol, value * 100]),
    ),
    weighting,
    weightingLabel: weightingLabels[weighting],
    source: 'Yahoo Finance',
    interval,
  }
}
