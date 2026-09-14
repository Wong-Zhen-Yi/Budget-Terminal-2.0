import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

import type { CardPerformanceInput, Portfolio } from '../electron/shared/contract.js'
import {
  BUILTIN_INDEX_CARD_ID,
  STARTER_CUSTOM_CARDS,
  buildCardModels,
  computeCardPerformance,
  defaultCardsPayload,
  normalizeCardSymbols,
  normalizeCardWeights,
  reorderCardIds,
} from '../electron/shared/cards.js'
import { clearCards, mutateCards, readCards } from '../electron/services/cardsStore.js'
import { getCardsPerformance } from '../electron/services/yahoo/cards.js'

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function pureChecks(): void {
  assert(
    JSON.stringify(normalizeCardSymbols('spy, bnd SPY;gld')) === JSON.stringify(['SPY', 'BND', 'GLD']),
    'symbols should uppercase, split and de-duplicate',
  )
  const weights = normalizeCardWeights(['SPY', 'BND'], { SPY: 6, BND: 4 })
  assert(weights.SPY === 60 && weights.BND === 40, 'custom weights should normalize to 100%')

  const state = defaultCardsPayload('probe')
  assert(state.customCards.length === 3, 'the three starter cards should be present')
  assert(state.cardOrder[0] === BUILTIN_INDEX_CARD_ID, 'the built-in Index card should lead')
  const visibleIds = ['a', 'b', 'c', 'd']
  assert(
    JSON.stringify(reorderCardIds(visibleIds, [...visibleIds, 'hidden'], 'a', 'c', 'after'))
      === JSON.stringify(['b', 'c', 'a', 'd', 'hidden']),
    'dropping after a later card should account for the removed source position',
  )
  assert(
    JSON.stringify(reorderCardIds(visibleIds, [...visibleIds, 'hidden'], 'd', 'b', 'before'))
      === JSON.stringify(['a', 'd', 'b', 'c', 'hidden']),
    'dropping before an earlier card should preserve the intended insertion edge',
  )

  const portfolio: Portfolio = {
    id: 'portfolio_1',
    name: 'Core',
    tickers: ['AAA', 'BBB'],
    holdings: {
      AAA: { ticker: 'AAA', shares: 2, avgPrice: 0, includeInWeight: true },
      BBB: { ticker: 'BBB', shares: 1, avgPrice: 0, includeInWeight: false },
    },
    cashBalance: 100,
    marginDebt: 0,
    options: [],
    includeCashInWeight: true,
    readOnly: false,
  }
  const models = buildCardModels(state, [portfolio])
  assert(
    JSON.stringify(models.slice(0, 4).map((model) => model.id))
      === JSON.stringify([BUILTIN_INDEX_CARD_ID, ...STARTER_CUSTOM_CARDS.map((card) => card.id)]),
    'Index and the three starter cards should lead the page',
  )
  const portfolioModel = models.find((model) => model.id === 'portfolio:portfolio_1')
  assert(portfolioModel?.symbols.length === 1 && portfolioModel.symbols[0] === 'AAA', 'unchecked holdings should stay out')

  const timestamps = [1, 2, 3]
  const series = {
    AAA: { timestamps, values: [100, 105, 110] },
    BBB: { timestamps, values: [100, 95, 90] },
  }
  const base: CardPerformanceInput = {
    id: 'test', symbols: ['AAA', 'BBB'], weighting: 'equal', weights: {}, shares: {}, cashBalance: 0,
  }
  const equal = computeCardPerformance(base, series, '1y')
  assert(Math.abs(equal.returnPct) < 0.000001, 'opposite equal-weight returns should offset')
  for (const interval of ['1d', '30d', '1y'] as const) {
    const intervalResult = computeCardPerformance(base, series, interval)
    assert(intervalResult.interval === interval, `${interval} performance should retain its timeframe`)
  }
  const custom = computeCardPerformance(
    { ...base, weighting: 'custom', weights: { AAA: 80, BBB: 20 } },
    series,
    '1y',
  )
  assert(Math.abs(custom.returnPct - 6) < 0.000001, 'custom weights should drive performance')
  const partial = computeCardPerformance(base, { AAA: series.AAA }, '1y')
  assert(
    partial.includedSymbols[0] === 'AAA' && partial.missingSymbols[0] === 'BBB',
    'one missing ticker should leave the rest of its card usable',
  )
  const actual = computeCardPerformance(
    { ...base, weighting: 'portfolio', shares: { AAA: 2, BBB: 1 }, cashBalance: 100 },
    series,
    '1y',
  )
  assert(actual.weighting === 'portfolio', 'saved shares should select actual portfolio weighting')
  assert(actual.weights.AAA > actual.weights.BBB, 'market value should drive portfolio weights')
  assert(actual.weights.CASH > 0, 'brokerage cash should be included in actual weights')
  assert(Math.abs(Object.values(actual.weights).reduce((sum, value) => sum + value, 0) - 100) < 0.000001, 'weights should sum to 100%')
}

async function persistenceChecks(): Promise<void> {
  const folder = await mkdtemp(join(tmpdir(), 'budget-terminal-cards-'))
  const target = join(folder, 'strategies.json')
  const originalAppData = process.env.APPDATA
  const originalLocalAppData = process.env.LOCALAPPDATA
  process.env.APPDATA = folder
  process.env.LOCALAPPDATA = folder
  try {
    await mkdir(join(folder, 'BudgetTerminal'))
    await writeFile(join(folder, 'BudgetTerminal', 'strategies.json'), JSON.stringify({
      ...defaultCardsPayload(target),
      customCards: [{ id: 'custom:legacy', name: 'Legacy fixture', symbols: ['TEST'], weighting: 'equal' }],
    }))
    let state = await readCards(target)
    assert(!state.customCards.some((card) => card.id === 'custom:legacy'), 'old app cards must not be imported')
    assert(state.customCards.length === 3, 'a new Cards store should seed starter cards')
    state = await mutateCards({
      type: 'add',
      name: 'AI Basket',
      symbols: ['NVDA', 'AVGO'],
      weighting: 'custom',
      weights: { NVDA: 70, AVGO: 30 },
    }, target)
    const added = state.customCards.find((card) => card.name === 'AI Basket')
    assert(added?.weights.NVDA === 70, 'custom cards should persist normalized weights')
    state = await mutateCards({ type: 'setInterval', id: added.id, interval: '30d' }, target)
    assert(state.intervals[added.id] === '30d', 'per-card intervals should persist')
    state = await mutateCards({
      type: 'setPortfolioVisible', portfolioId: 'portfolio_2', visible: false,
    }, target)
    assert(state.hiddenPortfolioIds.includes('portfolio_2'), 'portfolio visibility should persist')
    state = await mutateCards({
      type: 'reorder', order: [added.id, BUILTIN_INDEX_CARD_ID],
    }, target)
    assert(state.cardOrder[0] === added.id, 'card reorder should persist')
    state = await clearCards(target)
    assert(state.customCards.length === 0, 'clear should remove custom cards')
    assert(state.cardOrder.length === 1 && state.cardOrder[0] === BUILTIN_INDEX_CARD_ID, 'clear should retain Index')
  } finally {
    if (originalAppData === undefined) delete process.env.APPDATA
    else process.env.APPDATA = originalAppData
    if (originalLocalAppData === undefined) delete process.env.LOCALAPPDATA
    else process.env.LOCALAPPDATA = originalLocalAppData
    await rm(folder, { recursive: true, force: true })
  }
}

async function liveCheck(): Promise<void> {
  const card = {
      id: BUILTIN_INDEX_CARD_ID,
      symbols: ['SPY'],
      weighting: 'custom' as const,
      weights: { SPY: 100 },
      shares: {},
      cashBalance: 0,
  }
  for (const interval of ['1d', '30d', '1y'] as const) {
    const result = await getCardsPerformance({ interval, force: true, cards: [card] })
    assert(
      result.payload.results[BUILTIN_INDEX_CARD_ID]?.values.length >= 2,
      `live SPY ${interval} history should render`,
    )
  }
}

async function main(): Promise<void> {
  pureChecks()
  await persistenceChecks()
  if (process.argv.includes('--live')) await liveCheck()
  console.log(`Cards probe passed (${process.argv.includes('--live') ? 'live' : 'offline'}).`)
}

await main()
