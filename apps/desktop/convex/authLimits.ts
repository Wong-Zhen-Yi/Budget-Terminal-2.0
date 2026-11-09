import { v } from 'convex/values'
import { internalMutation } from './_generated/server'
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
export const email = internalMutation({ args: { identifierHash: v.string() }, handler: async (ctx, args) => {
  // Return refusal instead of throwing so consumed budgets commit even on denied requests.
  if (!/^[a-f0-9]{64}$/.test(args.identifierHash)) return false
  const global = await takeAuthLimit(ctx, 'email:global', 100, 3_600_000)
  if (!global) return false
  const recipient = await takeAuthLimit(ctx, `email:${args.identifierHash}`, 5, 3_600_000)
  return recipient
} })
