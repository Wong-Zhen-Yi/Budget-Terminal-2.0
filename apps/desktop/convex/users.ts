import { v } from 'convex/values'
import { vGithubProfile } from '@convex-dev/auth/methods/github/server'
import { vGoogleProfile } from '@convex-dev/auth/methods/google/server'
import { internalMutation } from './_generated/server'
import type { MutationCtx } from './_generated/server'

// Only the provider components can call these with a verified profile.
// Link by stable provider ID; display names and email addresses cannot prove ownership,
// so a Google sign-in never joins a GitHub account that shares the same email.
async function existingOrNewUser(ctx: MutationCtx, provider: 'github' | 'google', providerAccountId: string) {
  const previous = await ctx.db.query('authAccounts')
    .withIndex('providerAndAccountId', q => q.eq('provider', provider).eq('providerAccountId', providerAccountId)).unique()
  if (previous) {
    if (!await ctx.db.get(previous.userId)) throw new Error('Existing account needs recovery.')
    return previous.userId
  }
  return await ctx.db.insert('users', {})
}

export const createGithubUser = internalMutation({
  args: { method: v.object({ name: v.literal('github'), profile: vGithubProfile }) },
  returns: v.id('users'),
  handler: async (ctx, { method }) => existingOrNewUser(ctx, 'github', method.profile.id),
})

export const updateGithubProfile = internalMutation({
  args: { method: v.object({ name: v.literal('github'), profile: vGithubProfile }), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { method, userId }) => {
    await ctx.db.patch(userId, { githubLogin: method.profile.login })
    return null
  },
})

export const createGoogleUser = internalMutation({
  args: { method: v.object({ name: v.literal('google'), profile: vGoogleProfile }) },
  returns: v.id('users'),
  handler: async (ctx, { method }) => existingOrNewUser(ctx, 'google', method.profile.id),
})

export const updateGoogleProfile = internalMutation({
  args: { method: v.object({ name: v.literal('google'), profile: vGoogleProfile }), userId: v.id('users') },
  returns: v.null(),
  handler: async (ctx, { method, userId }) => {
    // Only a Google-verified address is shown in account settings.
    await ctx.db.patch(userId, { googleEmail: method.profile.emailVerified ? method.profile.email : undefined })
    return null
  },
})
