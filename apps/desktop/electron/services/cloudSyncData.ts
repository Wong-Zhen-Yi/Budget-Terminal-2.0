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

function pristineData(payload: string): boolean {
  return payload === defaultSyncData()
}

export function defaultSyncData(): string {
  const { sourcePath: _sourcePath, ...cards } = defaultCardsPayload()
  return canonical({ version: 1, userData: defaultSyncUserData(), settings: defaultSyncSettings(),
    cards, articles: { articles: [] } })
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
  const value = z.object({ version: z.literal(1), userData: z.record(z.string(), z.unknown()),
    settings: z.object({ version: z.number(), tabOrder: z.array(z.string()), hiddenTabs: z.array(z.string()),
      favoriteTabs: z.array(z.string()), clockCountry: z.string(), time12h: z.boolean() }).passthrough(),
    cards: z.object({ version: z.number(), customCards: z.array(z.unknown()), cardOrder: z.array(z.string()) }).passthrough(),
    articles: z.record(z.string(), z.unknown()),
  }).parse(JSON.parse(payload))
  validateUserDataImport(value.userData)
  validateArticlesImport(value.articles)
  settingsSchema.parse(value.settings)
  normalizeCardsPayload(value.cards)
  return value
}

async function replace(payload: string): Promise<void> {
  const value = snapshot(payload) // Validate every store before replacing any of them.
  await importUserData(value.userData)
  await replaceSettings(value.settings)
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
export async function applySyncData(payload: string, updatedAt = Date.now(), requireExact = false): Promise<void> {
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
    const saved = await readSyncData()
    if (requireExact && saved !== canonical(JSON.parse(payload))) throw new Error('Cloud data cannot be represented by this version of the local stores. Local data was preserved.')
    await saveLocalMetadata({ payload: saved, updatedAt, pristine: false })
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
