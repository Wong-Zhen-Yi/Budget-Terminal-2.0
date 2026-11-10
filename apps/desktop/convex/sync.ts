import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { makeFunctionReference } from 'convex/server'
import { mutation, query, internalMutation } from './_generated/server'
import type { MutationCtx, QueryCtx } from './_generated/server'
import type { Doc, Id } from './_generated/dataModel'
import { ACCOUNT_BYTES, ACCOUNT_RECORDS, BATCH_BYTES, BATCH_RECORDS, PAGE_RECORDS, recordKey,
  recordBatches, splitSnapshot, utf8Bytes, validateRecord } from '../electron/shared/syncRecords'
import type { RecordKind, RecordValue, RemoteRecord, SyncSignal } from '../electron/shared/syncRecords'
import { takeAuthLimit } from './authLimits'
import { COMBINED_PORTFOLIO_ID, MAX_FINANCE_ROWS, MAX_PORTFOLIOS } from '../electron/shared/contract'

const problem = (code: string, message: string): never => { throw new ConvexError({ code, message }) }
function checkedRecord(value: RecordValue) {
  try { return validateRecord(value) }
  catch { return problem('INVALID_RECORD', 'One saved record is invalid. Local data is safe; check the record or contact support.') }
}
async function owner(ctx: QueryCtx) {
  const userId = await getAuthUserId(ctx)
  if (!userId) return problem('SIGN_IN', 'Sign in to sync your data.')
  return userId
}
const accountRow = (ctx: QueryCtx, userId: Id<'users'>) => ctx.db.query('syncAccounts').withIndex('by_user', q => q.eq('userId', userId)).unique()
async function account(ctx: QueryCtx) {
  const userId = await owner(ctx)
  const row = await accountRow(ctx, userId)
  if (row?.deleted) return problem('ACCOUNT_DELETED', 'This cloud account was deleted. Local data is retained and will not be uploaded.')
  return { userId, row }
}
const signal = (row: Doc<'syncAccounts'>): SyncSignal => ({ protocol: 2, epoch: row.epoch, seq: row.seq, updatedAt: row.updatedAt, migrated: row.migrated, deleted: row.deleted })
const publicRecord = (row: Doc<'syncRecords'>): RemoteRecord => ({ key: row.key, kind: row.kind as RecordKind, data: row.data, revision: row.revision, seq: row.seq, updatedAt: row.updatedAt })
const findRecord = (ctx: QueryCtx, userId: Id<'users'>, key: string) => ctx.db.query('syncRecords').withIndex('by_user_key', q => q.eq('userId', userId).eq('key', key)).unique()

export const authConfiguration = query({ args: {}, handler: async () => {
  const configured = (value: string | undefined) => Boolean(value?.trim() && !['undefined', 'null'].includes(value.trim()))
  return { protocol: 2, githubConfigured: configured(process.env.AUTH_GITHUB_ID) && configured(process.env.AUTH_GITHUB_SECRET),
    emailConfigured: false }
} })
export const identity = query({ args: {}, handler: async ctx => (await account(ctx)).userId })
export const accountLabel = query({ args: {}, handler: async ctx => {
  const { userId } = await account(ctx)
  const profile = await ctx.db.get(userId)
  return profile?.email || profile?.name || 'Signed-in account'
} })

// Released snapshot clients can read their archived copy, but cannot write a second truth.
export const read = query({ args: {}, handler: async ctx => {
  const { userId } = await account(ctx)
  const row = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
  return row ? { revision: row.revision, payload: row.payload, updatedAt: row.updatedAt } : null
} })
export const exportInfo = query({ args: {}, handler: async ctx => {
  const { userId, row } = await account(ctx)
  const profile = await ctx.db.get(userId)
  const legacy = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
  return { profile: profile ? { name: profile.name ?? null, email: profile.email ?? null } : null,
    legacySnapshot: legacy ? { payload: legacy.payload, revision: legacy.revision, updatedAt: legacy.updatedAt } : null,
    storageBytes: row?.bytes ?? 0, historyBytes: row?.historyBytes ?? 0 }
} })
export const write = mutation({ args: { expectedRevision: v.number(), payload: v.string() }, handler: async ctx => {
  await account(ctx)
  return problem('UPGRADE_REQUIRED', 'Update Budget Terminal to use record sync. Your saved cloud snapshot is preserved.')
} })

/** Starts migration and locks old clients before the first record is written. */
export const prepare = mutation({ args: {}, handler: async ctx => {
  const { userId, row } = await account(ctx)
  if (row) return signal(row)
  const legacy = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
  const value = { userId, epoch: crypto.randomUUID(), seq: 0, updatedAt: Date.now(), migrated: !legacy,
    migrationOffset: 0, deleted: false, recordCount: 0, bytes: 0, windowStart: Date.now(), writes: 0,
    dayStart: Date.now(), dailyBytes: 0, historyBytes: 0, domainCounts: {} }
  await ctx.db.insert('syncAccounts', value)
  return { protocol: 2 as const, epoch: value.epoch, seq: value.seq, updatedAt: value.updatedAt, migrated: value.migrated, deleted: false }
} })

async function checkReferences(ctx: QueryCtx, userId: Id<'users'>, record: RecordValue, batch: RecordValue[]) {
  const data = checkedRecord(record)
  if (!data) return
  const owned = async (key: string) => {
    const pending = batch.find(value => value.key === key)
    return pending ? pending.data !== null : (await findRecord(ctx, userId, key))?.data != null
  }
  if (['ticker', 'holding', 'option'].includes(record.kind) && !await owned(recordKey('portfolio', data.portfolioId as string))) {
    problem('INVALID_REFERENCE', 'The parent portfolio does not exist in your account.')
  }
  if (record.kind === 'article') {
    let length = 0
    for (const hash of data.chunks as string[]) {
      const key = recordKey('chunk', hash)
      const value = batch.find(value => value.key === key) ?? await findRecord(ctx, userId, key)
      if (!value?.data) problem('INVALID_REFERENCE', 'Article content is incomplete. Retry sync.')
      length += (JSON.parse(value!.data!).text as string).length
    }
    if (length > 1_000_000) problem('RECORD_LIMIT', 'Article content exceeds one million characters.')
  }
  if (record.kind === 'preference' && ['user.activeId', 'user.mainId'].includes(data.name as string) && data.value !== null &&
      !(data.name === 'user.activeId' && data.value === COMBINED_PORTFOLIO_ID) &&
      !await owned(recordKey('portfolio', data.value as string))) problem('INVALID_REFERENCE', 'The selected portfolio does not belong to your account.')
}

async function storeRecord(ctx: MutationCtx, state: Doc<'syncAccounts'>, value: RecordValue, previous: Doc<'syncRecords'> | null) {
  if (value.kind === 'chunk' && previous && previous.data !== value.data) problem('IMMUTABLE_CONTENT', 'Article content chunks cannot be replaced.')
  const bytes = utf8Bytes(value.data ?? '') - utf8Bytes(previous?.data ?? '')
  const historyBytes = previous ? utf8Bytes(previous.data ?? '') : 0
  const domainLimit = value.kind === 'portfolio' ? MAX_PORTFOLIOS : ['cash', 'debt', 'bill'].includes(value.kind) ? MAX_FINANCE_ROWS : undefined
  if (domainLimit !== undefined) {
    const current = state.domainCounts[value.kind] ?? 0
    const next = current + Number(value.data !== null) - Number(previous?.data != null)
    if (next > domainLimit) problem('DOMAIN_LIMIT', 'This library reached the portfolio or finance row limit. Local changes are retained; remove an unwanted record explicitly before retrying.')
    if (value.kind === 'portfolio' && value.data === null && previous?.data != null && next < 1) problem('LAST_PORTFOLIO', 'Keep at least one portfolio. Clear its holdings instead of deleting the last portfolio.')
    state.domainCounts[value.kind] = next
  }
  if (Date.now() - state.dayStart >= 86_400_000) { state.dayStart = Date.now(); state.dailyBytes = 0 }
  const uploadBytes = utf8Bytes(value.data ?? '')
  if (state.dailyBytes + uploadBytes > 100_000_000 || state.historyBytes + historyBytes > 100_000_000) problem('ACCOUNT_LIMIT', 'The daily upload or retained history limit is reached. Local saves continue; contact support or retry later.')
  if (state.bytes + bytes > ACCOUNT_BYTES || state.recordCount + (previous ? 0 : 1) > ACCOUNT_RECORDS) problem('ACCOUNT_LIMIT', 'Your cloud storage limit is reached. Export your data or contact support. Local saves continue.')
  state.seq++
  state.updatedAt = Math.max(Date.now(), state.updatedAt + 1)
  state.bytes += bytes
  state.dailyBytes += uploadBytes
  state.historyBytes += historyBytes
  if (!previous) state.recordCount++
  const next = { userId: state.userId, ...value, revision: (previous?.revision ?? 0) + 1, seq: state.seq, updatedAt: state.updatedAt }
  if (previous) {
    // Prior financial edits remain recoverable for 30 days, even after an explicit resolution.
    const { _id: _id, _creationTime: _creationTime, ...history } = previous
    await ctx.db.insert('syncHistory', { ...history, expiresAt: Date.now() + 30 * 86_400_000 })
    await ctx.db.replace(previous._id, next)
  } else await ctx.db.insert('syncRecords', next)
  return publicRecord(next as Doc<'syncRecords'>)
}
async function saveState(ctx: MutationCtx, state: Doc<'syncAccounts'>) {
  const { _id, _creationTime: _creationTime, ...value } = state
  await ctx.db.replace(_id, value)
}
function consumeWrites(state: Doc<'syncAccounts'>, count: number) {
  if (Date.now() - state.windowStart >= 60_000) { state.windowStart = Date.now(); state.writes = 0 }
  if (state.writes + count > 600) problem('RATE_LIMIT', 'Sync is busy. Wait a minute and retry; your local changes are saved.')
  state.writes += count
}

export const migrate = mutation({ args: { epoch: v.string() }, handler: async (ctx, args) => {
  const { userId, row } = await account(ctx)
  if (!row || row.epoch !== args.epoch) return problem('RESYNC_REQUIRED', 'Reconnect to the cloud account.')
  if (row.migrated) return signal(row)
  const legacy = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
  if (!legacy) return problem('MIGRATION_SOURCE', 'The migration source is missing. Contact the service operator; local data is safe.')
  let all: RecordValue[]
  try { all = splitSnapshot(legacy.payload) }
  catch { return problem('MIGRATION_SOURCE', 'The archived library needs operator validation. The original snapshot and local files are preserved.') }
  const batch = recordBatches(all.slice(row.migrationOffset))[0] ?? []
  if (!await takeAuthLimit(ctx, 'sync:global-bytes', 1_000_000_000, 86_400_000, utf8Bytes(JSON.stringify(batch)))) problem('RATE_LIMIT', 'The service migration budget is reached. Try again later.')
  consumeWrites(row, batch.length)
  for (const value of batch) {
    await checkReferences(ctx, userId, value, batch)
    const previous = await findRecord(ctx, userId, value.key)
    if (!previous) await storeRecord(ctx, row, value, null)
    else if (previous.data !== value.data) problem('MIGRATION_CONFLICT', 'Migration requires operator recovery; the original cloud snapshot is preserved.')
  }
  row.migrationOffset += batch.length
  row.migrated = row.migrationOffset === all.length
  await saveState(ctx, row)
  return signal(row)
} })

export const changes = query({ args: { epoch: v.string(), cursor: v.number() }, handler: async (ctx, args) => {
  const { userId, row } = await account(ctx)
  if (!row || row.epoch !== args.epoch) return problem('RESYNC_REQUIRED', 'Cloud history changed. A full sync is required.')
  if (!row.migrated) return problem('MIGRATING', 'Your saved cloud library is being upgraded.')
  if (!Number.isSafeInteger(args.cursor) || args.cursor < 0 || args.cursor > row.seq) return problem('INVALID_CURSOR', 'Invalid sync cursor. A full sync is required.')
  // Latest versions form a durable compact change feed. Permanent tombstones keep cursors valid.
  const records = await ctx.db.query('syncRecords').withIndex('by_user_seq', q => q.eq('userId', userId).gt('seq', args.cursor)).take(PAGE_RECORDS)
  return { records: records.map(publicRecord), cursor: records.at(-1)?.seq ?? args.cursor, done: records.length < PAGE_RECORDS, signal: signal(row) }
} })
export const watch = query({ args: {}, handler: async ctx => {
  const { row } = await account(ctx)
  return row ? signal(row) : null
} })
const recordValidator = v.object({ key: v.string(), kind: v.string(), data: v.union(v.string(), v.null()), expectedRevision: v.number() })
export const push = mutation({ args: { epoch: v.string(), records: v.array(recordValidator) }, handler: async (ctx, args) => {
  const { userId, row } = await account(ctx)
  if (!row || row.epoch !== args.epoch) return problem('RESYNC_REQUIRED', 'Reconnect before syncing changes.')
  if (!row.migrated) return problem('MIGRATING', 'Wait for cloud library migration to finish.')
  if (!args.records.length || args.records.length > BATCH_RECORDS || utf8Bytes(JSON.stringify(args.records)) > BATCH_BYTES) return problem('BATCH_LIMIT', 'Sync batch is too large.')
  if (args.records.filter(value => value.kind === 'article').length > 1) return problem('BATCH_LIMIT', 'Publish one article per batch to keep content validation bounded.')
  if (new Set(args.records.map(value => value.key)).size !== args.records.length) return problem('INVALID_RECORD', 'Duplicate record IDs in one batch.')
  const records: RemoteRecord[] = []; const conflicts: RemoteRecord[] = []
  const batch = args.records as (RecordValue & { expectedRevision: number })[]
  if (!await takeAuthLimit(ctx, 'sync:global-bytes', 1_000_000_000, 86_400_000, utf8Bytes(JSON.stringify(batch)))) problem('RATE_LIMIT', 'The service upload budget is reached. Local data is safe; try again later.')
  consumeWrites(row, batch.length)
  for (const value of batch) {
    checkedRecord(value)
    if (!Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0) problem('INVALID_REVISION', 'Invalid saved record revision.')
  }
  for (const { expectedRevision, ...value } of batch) {
    const previous = await findRecord(ctx, userId, value.key)
    if (previous?.data === value.data) { records.push(publicRecord(previous)); continue }
    if ((previous?.revision ?? 0) !== expectedRevision) {
      if (previous) conflicts.push(publicRecord(previous))
      else problem('INVALID_REVISION', 'This record is missing. Retry sync.')
      continue
    }
    await checkReferences(ctx, userId, value, [])
    records.push(await storeRecord(ctx, row, value, previous))
  }
  await saveState(ctx, row)
  return { records, conflicts, signal: signal(row) }
} })

const purgeRef = makeFunctionReference<'mutation', { userId: Id<'users'> }, null>('sync:purgeAccount')
export const deleteAccount = mutation({ args: { confirmation: v.literal('DELETE MY ACCOUNT') }, handler: async ctx => {
  const userId = await owner(ctx)
  const row = await accountRow(ctx, userId)
  if (row?.deleted) return null
  if (row) await ctx.db.patch(row._id, { deleted: true, updatedAt: Date.now(), seq: row.seq + 1 })
  else await ctx.db.insert('syncAccounts', { userId, epoch: crypto.randomUUID(), seq: 1, updatedAt: Date.now(), migrated: true,
    migrationOffset: 0, deleted: true, recordCount: 0, bytes: 0, windowStart: Date.now(), writes: 0,
    dayStart: Date.now(), dailyBytes: 0, historyBytes: 0, domainCounts: {} })
  await ctx.scheduler.runAfter(0, purgeRef, { userId })
  return null
} })
export const purgeAccount = internalMutation({ args: { userId: v.id('users') }, handler: async (ctx, { userId }) => {
  const fence = await accountRow(ctx, userId)
  if (!fence?.deleted) return null
  for (const rows of [
    await ctx.db.query('syncRecords').withIndex('by_user_seq', q => q.eq('userId', userId)).take(32),
    await ctx.db.query('syncHistory').withIndex('by_user', q => q.eq('userId', userId)).take(32),
    await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).take(1),
  ]) {
    for (const row of rows) await ctx.db.delete(row._id)
    if (rows.length) { await ctx.scheduler.runAfter(0, purgeRef, { userId }); return null }
  }
  const sessions = await ctx.db.query('authSessions').withIndex('userId', q => q.eq('userId', userId)).take(1)
  for (const session of sessions) {
    const tokens = await ctx.db.query('authRefreshTokens').withIndex('sessionId', q => q.eq('sessionId', session._id)).take(32)
    const verifiers = await ctx.db.query('authVerifiers').withIndex('by_session', q => q.eq('sessionId', session._id)).take(32)
    for (const token of tokens) await ctx.db.delete(token._id)
    for (const verifier of verifiers) await ctx.db.delete(verifier._id)
    if (!tokens.length && !verifiers.length) await ctx.db.delete(session._id)
    await ctx.scheduler.runAfter(0, purgeRef, { userId }); return null
  }
  const accounts = await ctx.db.query('authAccounts').withIndex('userIdAndProvider', q => q.eq('userId', userId)).take(1)
  for (const authAccount of accounts) {
    const codes = await ctx.db.query('authVerificationCodes').withIndex('accountId', q => q.eq('accountId', authAccount._id)).take(32)
    for (const code of codes) await ctx.db.delete(code._id)
    if (!codes.length) await ctx.db.delete(authAccount._id)
    await ctx.scheduler.runAfter(0, purgeRef, { userId }); return null
  }
  const profile = await ctx.db.get(userId)
  if (profile?.email) {
    const limit = await ctx.db.query('authRateLimits').withIndex('identifier', q => q.eq('identifier', profile.email!)).unique()
    if (limit) await ctx.db.delete(limit._id)
  }
  if (profile) await ctx.db.delete(userId)
  await ctx.db.patch(fence._id, { recordCount: 0, bytes: 0, historyBytes: 0, domainCounts: {} })
  return null
} })

export const cleanupHistory = internalMutation({ args: {}, handler: async ctx => {
  const rows = await ctx.db.query('syncHistory').withIndex('by_expiry', q => q.lt('expiresAt', Date.now())).take(100)
  for (const row of rows) {
    const state = await accountRow(ctx, row.userId)
    if (state) await ctx.db.patch(state._id, { historyBytes: Math.max(0, state.historyBytes - utf8Bytes(row.data ?? '')) })
    await ctx.db.delete(row._id)
  }
  const limits = await ctx.db.query('syncAuthLimits').withIndex('by_start', q => q.lt('start', Date.now() - 86_400_000)).take(100)
  for (const row of limits) await ctx.db.delete(row._id)
  const attempts = await ctx.db.query('authRateLimits').withIndex('by_attempt', q => q.lt('lastAttemptTime', Date.now() - 86_400_000)).take(100)
  for (const row of attempts) await ctx.db.delete(row._id)
  return null
} })
