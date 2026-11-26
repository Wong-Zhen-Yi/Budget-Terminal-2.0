import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { createHash, randomUUID } from 'node:crypto'
import { z } from 'zod'
import { defaultSyncUserData, exportUserData, importUserData, validateUserDataImport } from './portfolioStore.js'
import { defaultSyncSettings, exportSettings, replaceSettings, settingsSchema } from './settingsStore.js'
import { exportCards, replaceCards } from './cardsStore.js'
import { readArticles, replaceArticles, validateArticlesImport } from './articlesStore.js'
import { publishSavedDataChanged } from './savedDataEvents.js'
import { defaultCardsPayload, normalizeCardsPayload } from '../shared/cards.js'
import type { LocalSyncSnapshot } from '../shared/cloudSync.js'
import { parseCloudSnapshot } from '../shared/cloudSnapshot.js'

export const cloudDataPath = (name: string) => join(process.env.APPDATA!, 'BudgetTerminalElectron', name)

export async function atomicSyncFile(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  try {
    await writeFile(temporary, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 })
    await rename(temporary, path)
  } finally { await rm(temporary, { force: true }) }
}

/** Stable serialization prevents object key order from creating spurious conflicts. */
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.entries(value).filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b, 'en')).map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`
  return JSON.stringify(value)
}

/** Operation-local capture only; never retain snapshots across external file writes. */
export async function captureSavedData() {
  const settings = await exportSettings()
  const data = { version: 1, userData: await exportUserData(), settings,
    cards: await exportCards(), articles: { articles: (await readArticles()).articles } }
  const { lastBackupAt: _lastBackupAt, ...syncSettings } = settings
  let payload: string | undefined
  let payloadHash: string | undefined
  const serialize = () => payload ??= canonical({ ...data, settings: syncSettings })
  return { data, get payload() { return serialize() }, get hash() { return payloadHash ??= hash(serialize()) } }
}

export async function readSyncData(): Promise<string> {
  return (await captureSavedData()).payload
}

const metadataPath = () => cloudDataPath('sync-local-metadata.json')
const metadataSchema = z.object({ hash: z.string(), updatedAt: z.number().finite().nonnegative(), pristine: z.boolean() })
const hash = (payload: string) => createHash('sha256').update(payload).digest('hex')

function defaultPayload(): string {
  const { sourcePath: _sourcePath, ...cards } = defaultCardsPayload()
  return canonical({ version: 1, userData: defaultSyncUserData(), settings: defaultSyncSettings(),
    cards, articles: { articles: [] } })
}

function pristineData(payload: string): boolean {
  return payload === defaultPayload()
}

const record = (value: unknown): Record<string, unknown> =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {}
const list = (value: unknown): unknown[] => Array.isArray(value) ? value : []

/**
 * A snapshot holding no saved records: no positions, cash, options, finance entries, watchlists,
 * articles or custom cards beyond the shipped starters. Preferences are ignored, because every
 * build normalizes tabs and settings to what it ships, so defaults written by another version
 * (or with a changed preference) are never mistaken for work worth restoring over this device.
 */
export function isFactoryDefaultPayload(payload: string): boolean {
  try {
    const value: unknown = JSON.parse(payload)
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false
    const { userData, cards, articles } = record(value)
    if (list(record(articles).articles).length) return false
    const starters = new Set(defaultCardsPayload().customCards.map(card => canonical(card)))
    if (list(record(cards).customCards).some(card => !starters.has(canonical(card)))) return false
    const data = record(userData)
    const portfolios = Object.values(record(data.portfolios)).map(record)
    if (portfolios.length > 1) return false
    if (portfolios.some(item => list(item.tickers).length || Object.keys(record(item.holdings)).length
      || list(item.options).length || Number(item.cashBalance ?? 0) !== 0 || Number(item.marginDebt ?? 0) !== 0)) return false
    const finance = record(data.personalFinance)
    if (list(finance.cash).length || list(finance.debt).length || list(finance.recurringBills).length
      || Number(record(finance.goal).targetAmount ?? 0) !== 0) return false
    const watchlists = record(data.chartsWatchlists)
    return !Object.values(watchlists).some(entry => list(entry).length)
  } catch { return false }
}

async function saveLocalMetadata(value: LocalSyncSnapshot, payloadHash = hash(value.payload)): Promise<void> {
  await atomicSyncFile(metadataPath(), { hash: payloadHash, updatedAt: value.updatedAt, pristine: value.pristine })
}

/** Called under the save queue, including while disconnected. Defaults have no edit time. */
export async function readLocalSyncData(captured?: Awaited<ReturnType<typeof captureSavedData>>): Promise<LocalSyncSnapshot> {
  const { payload, hash: payloadHash } = captured ?? await captureSavedData()
  let previous: z.infer<typeof metadataSchema> | undefined
  let uncertain = false
  try { previous = metadataSchema.parse(JSON.parse(await readFile(metadataPath(), 'utf8'))) }
  catch (error) {
    if (error instanceof SyntaxError || error instanceof z.ZodError) uncertain = true
    else if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
  }
  if (previous?.hash === payloadHash) return { payload, updatedAt: previous.updatedAt, pristine: previous.pristine }
  const pristine = !uncertain && previous === undefined && pristineData(payload)
  const updatedAt = pristine ? 0 : Math.max(Date.now(), (previous?.updatedAt ?? 0) + 1)
  const value = { payload, updatedAt, pristine }
  await saveLocalMetadata(value, payloadHash)
  return value
}

function snapshot(payload: string) {
  // Local backup import and crash recovery must continue to support libraries over the cloud byte cap.
  const value = parseCloudSnapshot(payload, false)
  validateUserDataImport(value.userData)
  validateArticlesImport(value.articles)
  settingsSchema.parse(value.settings)
  normalizeCardsPayload(value.cards)
  return value
}

async function replace(payload: string): Promise<void> {
  const value = snapshot(payload) // Validate every store before replacing any of them.
  await importUserData(value.userData)
  await replaceSettings(value.settings, { preserveLabs: true })
  await replaceCards(value.cards)
  await replaceArticles(value.articles)
}

const journalPath = () => cloudDataPath('sync-apply-journal.json')

/** Called before the window opens. A crash during replacement restores the prior local copy. */
export async function recoverSyncData(): Promise<void> {
  let raw: string
  try { raw = await readFile(journalPath(), 'utf8') }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return; throw error }
  const journal = z.object({ before: z.string(), local: z.object({ updatedAt: z.number(), pristine: z.boolean() }).optional() }).parse(JSON.parse(raw))
  await replace(journal.before)
  if (journal.local) await saveLocalMetadata({ payload: journal.before, ...journal.local })
  await rm(journalPath())
}

/** Caller holds the saved-data lock and has checked that local data has not changed. */
export async function applySyncData(payload: string, updatedAt = Date.now()): Promise<void> {
  snapshot(payload)
  const local = await readLocalSyncData()
  const before = local.payload
  // Keep a complete local recovery copy, including cards, settings and articles.
  await atomicSyncFile(cloudDataPath(`sync-backups/before-sync-${Date.now()}-${randomUUID()}.json`), {
    ...JSON.parse(before), app: 'budget-terminal-electron', exportedAt: new Date().toISOString(),
  })
  await atomicSyncFile(journalPath(), { before, local: { updatedAt: local.updatedAt, pristine: local.pristine } })
  try {
    await replace(payload)
    await saveLocalMetadata({ payload: await readSyncData(), updatedAt, pristine: false })
  }
  catch (error) {
    await replace(before)
    await saveLocalMetadata(local)
    await rm(journalPath())
    throw error
  }
  await rm(journalPath())
  publishSavedDataChanged(['portfolio', 'personalFinance', 'settings', 'cards', 'articles'])
}

/** Caller already holds the save queue through withAutomaticBackup. */
export async function importBackupData(backup: { userData: unknown; settings?: unknown; cards?: unknown; articles?: unknown }): Promise<void> {
  const current = JSON.parse(await readSyncData())
  const supplied = Object.fromEntries(Object.entries(backup).filter(([key, value]) => ['userData', 'settings', 'cards', 'articles'].includes(key) && value !== undefined))
  await applySyncData(canonical({ ...current, ...supplied, version: 1 }))
}
