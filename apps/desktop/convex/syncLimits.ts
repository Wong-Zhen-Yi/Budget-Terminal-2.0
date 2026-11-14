import { ConvexError } from 'convex/values'
import type { MutationCtx } from './_generated/server'
import type { Id } from './_generated/dataModel'

export const SYNC_WRITES_PER_MINUTE = 60
export const SYNC_BYTES_PER_DAY = 100_000_000
const MINUTE = 60_000
const DAY = 24 * 60 * MINUTE

/** Charged atomically with accepted changes; retries and conflicts consume no quota. */
export async function consumeSyncWrite(ctx: MutationCtx, userId: Id<'users'>, bytes: number) {
  const now = Date.now()
  const row = await ctx.db.query('syncWriteLimits').withIndex('by_user', q => q.eq('userId', userId)).unique()
  const windowStart = row && now - row.windowStart < MINUTE ? row.windowStart : now
  const dayStart = row && now - row.dayStart < DAY ? row.dayStart : now
  const writes = windowStart === row?.windowStart ? row.writes : 0
  const dailyBytes = dayStart === row?.dayStart ? row.dailyBytes : 0
  const retryAfterMs = Math.max(writes >= SYNC_WRITES_PER_MINUTE ? windowStart + MINUTE - now : 0,
    dailyBytes + bytes > SYNC_BYTES_PER_DAY ? dayStart + DAY - now : 0)
  if (retryAfterMs > 0) throw new ConvexError({ code: 'SYNC_RATE_LIMITED', retryAfterMs,
    message: 'This account has reached its cloud write allowance. Local data is preserved.' })
  const next = { userId, windowStart, writes: writes + 1, dayStart, dailyBytes: dailyBytes + bytes }
  if (row) await ctx.db.replace(row._id, next)
  else await ctx.db.insert('syncWriteLimits', next)
}
