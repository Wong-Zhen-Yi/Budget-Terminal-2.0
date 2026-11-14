import { mutation, query } from './_generated/server'
import { getAuthUserId } from '@convex-dev/auth/server'
import { ConvexError, v } from 'convex/values'
import { CloudSnapshotError, parseCloudSnapshot } from '../electron/shared/cloudSnapshot'
import { consumeSyncWrite } from './syncLimits'

// Public setup metadata contains only capability versions and a boolean.
export const authConfiguration = query({
  args: {},
  returns: v.object({ authVersion: v.literal(2), accountControlsVersion: v.literal(2), githubConfigured: v.boolean() }),
  handler: async () => {
    const configured = (value: string | undefined) => Boolean(value?.trim() && !['undefined', 'null'].includes(value.trim()))
    return { authVersion: 2 as const, accountControlsVersion: 2 as const,
      githubConfigured: configured(process.env.AUTH_GITHUB_ID) && configured(process.env.AUTH_GITHUB_SECRET) }
  },
})

export const identity = query({
  args: {},
  returns: v.id('users'),
  handler: async ctx => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in first.')
    return userId
  },
})

export const account = query({
  args: {},
  returns: v.object({ userId: v.id('users'), githubLogin: v.optional(v.string()) }),
  handler: async ctx => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in first.')
    const user = await ctx.db.get(userId)
    if (!user) throw new Error('Account unavailable.')
    return { userId, githubLogin: user.githubLogin }
  },
})

// Clients cannot supply another user's identity. Every read and write is scoped here.
export const read = query({
  args: {},
  returns: v.union(v.null(), v.object({ revision: v.number(), payload: v.string(), updatedAt: v.number() })),
  handler: async ctx => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in to sync your data.')
    const row = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
    return row ? { revision: row.revision, payload: row.payload, updatedAt: row.updatedAt } : null
  },
})

export const write = mutation({
  args: { expectedRevision: v.number(), payload: v.string() },
  returns: v.object({ accepted: v.boolean(), revision: v.number(), updatedAt: v.number() }),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx)
    if (!userId) throw new Error('Sign in to sync your data.')
    if (!Number.isSafeInteger(args.expectedRevision) || args.expectedRevision < 0) throw new Error('Invalid revision')
    try { parseCloudSnapshot(args.payload) }
    catch (error) {
      if (error instanceof CloudSnapshotError) throw new ConvexError({ code: error.code, message: error.message })
      throw error
    }
    const row = await ctx.db.query('syncSnapshots').withIndex('by_user', q => q.eq('userId', userId)).unique()
    const revision = row?.revision ?? 0
    // A lost response can be retried safely, without creating a false conflict.
    if (row?.payload === args.payload) return { accepted: true, revision, updatedAt: row.updatedAt }
    if (revision !== args.expectedRevision) return { accepted: false, revision, updatedAt: row?.updatedAt ?? 0 }
    await consumeSyncWrite(ctx, userId, new TextEncoder().encode(args.payload).length)
    const next = { userId, revision: revision + 1, payload: args.payload, updatedAt: Math.max(Date.now(), (row?.updatedAt ?? 0) + 1) }
    if (row) await ctx.db.replace(row._id, next)
    else await ctx.db.insert('syncSnapshots', next)
    return { accepted: true, revision: next.revision, updatedAt: next.updatedAt }
  },
})
