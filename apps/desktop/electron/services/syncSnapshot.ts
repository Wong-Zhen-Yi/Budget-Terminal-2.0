import { createHash, randomUUID } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { z } from 'zod'
import { createUserDataBundle, serializeUserData, withAutomaticBackup } from './automaticBackup.js'
import { importUserData, validateUserData } from './portfolioStore.js'
import { replaceCards } from './cardsStore.js'
import { replaceSettings } from './settingsStore.js'
import { ok } from '../shared/envelope.js'
import { normalizeCustomCard } from '../shared/cards.js'

const stringList = z.array(z.string())
const snapshotSchema = z.object({
  app: z.literal('budget-terminal-electron'), version: z.literal(1), exportedAt: z.iso.datetime(),
  userData: z.unknown(),
  settings: z.object({
    version: z.literal(1), clockCountry: z.string(), time12h: z.boolean(),
    tabOrder: stringList, hiddenTabs: stringList, favoriteTabs: stringList,
    sidebarCollapsed: z.boolean(), obscuredTabs: stringList,
    backtestPage: z.record(z.string(), z.unknown()), signalsPage: z.record(z.string(), z.unknown()),
    quantPage: z.record(z.string(), z.unknown()), youtubePage: z.record(z.string(), z.unknown()),
  }).passthrough(),
  cards: z.object({
    version: z.literal(2), starterCardsVersion: z.number().int(),
    customCards: z.array(z.object({
      id: z.string().min(1), name: z.string().min(1), symbols: stringList.min(1),
      weighting: z.enum(['equal', 'custom']), weights: z.record(z.string(), z.number().finite().nonnegative()),
    })),
    cardOrder: stringList, hiddenPortfolioIds: stringList,
    intervals: z.record(z.string(), z.enum(['1d', '30d', '1y'])),
  }),
})

export type SyncSnapshot = z.infer<typeof snapshotSchema>

export function validateSyncSnapshot(value: unknown): SyncSnapshot {
  const snapshot = snapshotSchema.parse(value)
  validateUserData(snapshot.userData)
  const ids = new Set<string>()
  for (const card of snapshot.cards.customCards) {
    const normalized = normalizeCustomCard(card)
    if (!normalized || normalized.id !== card.id || normalized.weighting !== card.weighting || ids.has(card.id) ||
      normalized.symbols.length !== card.symbols.length) throw new Error('The sync snapshot contains invalid or duplicate cards.')
    ids.add(card.id)
  }
  return snapshot
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical)
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, entry]) => [key, canonical(entry)]))
  }
  return value
}

/** Export times and this installation's reminder timestamp are not user edits. */
export function snapshotHash(snapshot: SyncSnapshot): string {
  const { lastBackupAt: _lastBackupAt, ...settings } = snapshot.settings
  return createHash('sha256').update(JSON.stringify(canonical({ userData: snapshot.userData, settings, cards: snapshot.cards }))).digest('hex')
}

export function readSyncSnapshot(): Promise<SyncSnapshot> {
  return serializeUserData(async () => validateSyncSnapshot(await createUserDataBundle()))
}

/** Check for concurrent edits inside the same queue used by all renderer/MCP writes. */
export async function applySyncSnapshot(snapshot: SyncSnapshot, expectedHash: string | undefined, recoveryDirectory: string) {
  const result = await withAutomaticBackup(async () => {
    validateSyncSnapshot(snapshot)
    const before = validateSyncSnapshot(await createUserDataBundle())
    if (expectedHash !== undefined && snapshotHash(before) !== expectedHash) throw new Error('Both devices have changed. Review the incoming snapshot before replacing local data.')
    await mkdir(recoveryDirectory, { recursive: true })
    const recoveryPath = join(recoveryDirectory, `before-sync-${Date.now()}-${randomUUID()}.json`)
    await writeFile(recoveryPath, JSON.stringify(before, null, 2), { mode: 0o600 })
    try {
      await importUserData(snapshot.userData)
      await replaceSettings(snapshot.settings)
      await replaceCards(snapshot.cards)
    } catch (error) {
      // Keep the complete recovery file even if restoring a failed disk write also fails.
      try {
        await importUserData(before.userData)
        await replaceSettings(before.settings)
        await replaceCards(before.cards)
      } catch (rollback) {
        throw new Error(`Sync failed and rollback failed: ${String(rollback)}. Restore ${recoveryPath}`)
      }
      throw error
    }
    return ok({ hash: snapshotHash(validateSyncSnapshot(await createUserDataBundle())), recoveryPath }, 'LocalSend sync')
  })
  return { ...result.data, warning: result.meta.failureReason }
}
