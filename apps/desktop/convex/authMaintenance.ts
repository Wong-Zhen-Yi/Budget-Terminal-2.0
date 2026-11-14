import { internalMutation } from './_generated/server'

export const cleanup = internalMutation({
  args: {},
  handler: async ctx => {
    for (const table of ['oauthRequests', 'sessionActionGrants'] as const) {
      for (const row of await ctx.db.query(table).withIndex('by_expiry', q => q.lte('expiresAt', Date.now())).take(500)) await ctx.db.delete(row._id)
    }
    const expired = Date.now() - 24 * 60 * 60_000
    for (const row of await ctx.db.query('oauthLimits').withIndex('by_window', q => q.lte('windowStart', expired)).take(500)) await ctx.db.delete(row._id)
    for (const row of await ctx.db.query('syncWriteLimits').withIndex('by_day', q => q.lte('dayStart', expired)).take(500)) await ctx.db.delete(row._id)
  },
})
