import type { MutationCtx } from './_generated/server'

export async function takeAuthLimit(ctx: MutationCtx, key: string, maximum: number, duration: number, amount = 1): Promise<boolean> {
  const row = await ctx.db.query('syncAuthLimits').withIndex('by_key', q => q.eq('key', key)).unique()
  const now = Date.now()
  if (!row) { await ctx.db.insert('syncAuthLimits', { key, start: now, count: amount }); return amount <= maximum }
  if (now - row.start >= duration) { await ctx.db.patch(row._id, { start: now, count: amount }); return amount <= maximum }
  if (row.count + amount > maximum) return false
  await ctx.db.patch(row._id, { count: row.count + amount })
  return true
}
