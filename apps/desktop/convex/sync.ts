import { mutationGeneric, queryGeneric } from 'convex/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { v } from 'convex/values'

// Public setup metadata contains only a boolean, never credentials or user records.
export const authConfiguration = queryGeneric({
  args: {},
  handler: async () => {
    const configured = (value: string | undefined) => Boolean(value?.trim() && !['undefined', 'null'].includes(value.trim()))
    return { githubConfigured: configured(process.env.AUTH_GITHUB_ID) && configured(process.env.AUTH_GITHUB_SECRET) }
  },
})

export const identity = queryGeneric({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in first.')
    return userId
  },
})

// Clients cannot supply another user's identity. Every read and write is scoped here.
export const read = queryGeneric({
  args: {},
  handler: async ctx => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in to sync your data.')
    const row = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
    return row ? { revision: row.revision as number, payload: row.payload as string, updatedAt: row.updatedAt as number } : null
  },
})

export const write = mutationGeneric({
  args: { expectedRevision: v.number(), payload: v.string() },
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in to sync your data.')
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new Error('Invalid revision')
    // Leave room under Convex's document limit. Large libraries fail visibly and stay local.
    if (new TextEncoder().encode(args.payload).length > 750_000) throw new Error('Saved data exceeds the 750 KB sync limit.')
    const value = JSON.parse(args.payload)
    if (value?.version !== 1 || !value.userData || !value.settings || !value.cards || !value.articles) throw new Error('Invalid snapshot')
    const row = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
    const revision = row?.revision ?? 0
    // A lost response can be retried safely, without creating a false conflict.
    if (row?.payload === args.payload) return { accepted: true, revision, updatedAt: row.updatedAt as number }
    if (revision !== args.expectedRevision) return { accepted: false, revision, updatedAt: (row?.updatedAt ?? 0) as number }
    const next = { userId, revision: revision + 1, payload: args.payload, updatedAt: Math.max(Date.now(), (row?.updatedAt ?? 0) + 1) }
    if (row) await ctx.db.replace(row._id, next)
    else await ctx.db.insert('syncSnapshots', next)
    return { accepted: true, revision: next.revision, updatedAt: next.updatedAt }
  },
})
