import { checkRecordRevision } from './mcpContext.js'
import { randomUUID } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import type { CardsMutation, CardsPayload } from '../shared/contract.js'
import {
  BUILTIN_INDEX_CARD_ID,
  CARDS_VERSION,
  STARTER_CARDS_VERSION,
  defaultCardsPayload,
  normalizeCardsPayload,
  normalizeCustomCard,
} from '../shared/cards.js'

export function cardsPath(): string {
  const appData = process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming')
  return join(appData, 'BudgetTerminalElectron', 'strategies.json')
}

function storedDocument(payload: CardsPayload): Omit<CardsPayload, 'sourcePath'> {
  const { sourcePath: _sourcePath, ...document } = payload
  return document
}

async function persistCards(payload: CardsPayload, targetPath: string): Promise<void> {
  await mkdir(dirname(targetPath), { recursive: true })
  const tempPath = join(
    dirname(targetPath),
    `.${targetPath.split(/[\\/]/).at(-1)}.${process.pid}.${Date.now()}.tmp`,
  )
  await writeFile(tempPath, JSON.stringify(storedDocument(payload), null, 2), 'utf8')
  await rename(tempPath, targetPath)
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === 'object' && 'code' in error && error.code === 'ENOENT')
}

export async function readCards(
  targetPath = cardsPath(),
): Promise<CardsPayload> {
  try {
    return normalizeCardsPayload(JSON.parse(await readFile(targetPath, 'utf8')), targetPath)
  } catch (error) {
    // A damaged document has nothing to recover and falls back to the starter cards; a
    // file that is merely unreadable this time (EBUSY, EPERM — an antivirus scan or a
    // sync client holding it) must not, or the next write persists the defaults over the
    // user's cards and the next export carries them.
    if (!isMissing(error)) {
      if (!(error instanceof SyntaxError)) throw error
      return defaultCardsPayload(targetPath)
    }
  }

  const defaults = defaultCardsPayload(targetPath)
  await persistCards(defaults, targetPath)
  return defaults
}

let writeChain = Promise.resolve()

function buildCustomCard(
  mutation: Extract<CardsMutation, { type: 'add' | 'update' }>,
  id: string,
) {
  const card = normalizeCustomCard({
    id,
    name: mutation.name,
    symbols: mutation.symbols,
    weighting: mutation.weighting,
    weights: mutation.weights,
  })
  if (!card) throw new Error('A card needs at least one ticker.')
  if (mutation.weighting === 'custom' && card.weighting !== 'custom') {
    throw new Error('Enter at least one positive custom weight.')
  }
  return card
}

function applyMutation(state: CardsPayload, mutation: CardsMutation): void {
  switch (mutation.type) {
    case 'add': {
      const card = buildCustomCard(mutation, `custom:${randomUUID().replaceAll('-', '')}`)
      state.customCards.push(card)
      state.cardOrder.push(card.id)
      return
    }
    case 'update': {
      const index = state.customCards.findIndex((card) => card.id === mutation.id)
      if (index < 0) throw new Error('That card no longer exists.')
      state.customCards[index] = buildCustomCard(mutation, mutation.id)
      return
    }
    case 'remove': {
      if (!state.customCards.some((card) => card.id === mutation.id)) {
        throw new Error('That card no longer exists.')
      }
      state.customCards = state.customCards.filter((card) => card.id !== mutation.id)
      state.cardOrder = state.cardOrder.filter((id) => id !== mutation.id)
      delete state.intervals[mutation.id]
      return
    }
    case 'reorder': {
      const order = [...new Set(mutation.order.map((id) => id.trim()).filter(Boolean))]
      for (const id of state.cardOrder) if (!order.includes(id)) order.push(id)
      if (!order.includes(BUILTIN_INDEX_CARD_ID)) order.unshift(BUILTIN_INDEX_CARD_ID)
      state.cardOrder = order
      return
    }
    case 'setPortfolioVisible': {
      if (mutation.visible) {
        state.hiddenPortfolioIds = state.hiddenPortfolioIds.filter(
          (id) => id !== mutation.portfolioId,
        )
      } else if (!state.hiddenPortfolioIds.includes(mutation.portfolioId)) {
        state.hiddenPortfolioIds.push(mutation.portfolioId)
      }
      return
    }
    case 'setInterval': {
      state.intervals[mutation.id] = mutation.interval
      return
    }
  }
}

export async function mutateCards(
  mutation: CardsMutation,
  targetPath = cardsPath(),
): Promise<CardsPayload> {
  let result: CardsPayload | null = null
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      const state = await readCards(targetPath)
      checkRecordRevision(state)
      applyMutation(state, mutation)
      result = normalizeCardsPayload(state, targetPath)
      await persistCards(result, targetPath)
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return result ?? readCards(targetPath)
}

/**
 * The stored cards document, for the user-data export.
 *
 * Read at the back of the write queue, so a card added or reordered moments before
 * Export was clicked is in the backup rather than missing from it.
 */
export async function exportCards(targetPath = cardsPath()): Promise<unknown> {
  let snapshot: unknown = null
  let failure: unknown = null
  const run = writeChain.then(async () => {
    try {
      snapshot = storedDocument(await readCards(targetPath))
    } catch (error) {
      failure = error
    }
  })
  writeChain = run
  await run
  if (failure) throw failure
  return snapshot
}

export async function replaceCards(value: unknown, targetPath = cardsPath()): Promise<CardsPayload> {
  const normalized = normalizeCardsPayload(value, targetPath)
  await persistCards(normalized, targetPath)
  return normalized
}

export async function clearCards(targetPath = cardsPath()): Promise<CardsPayload> {
  const cleared = normalizeCardsPayload({
    version: CARDS_VERSION,
    starterCardsVersion: STARTER_CARDS_VERSION,
    customCards: [],
    cardOrder: [BUILTIN_INDEX_CARD_ID],
    hiddenPortfolioIds: [],
    intervals: {},
  }, targetPath)
  await persistCards(cleared, targetPath)
  return cleared
}
