import { v } from 'convex/values'
import { vGithubProfile } from '@convex-dev/auth/methods/github/server'
import { internalMutation } from './_generated/server'

// Only the GitHub component can call this with a verified profile.
// Link by stable provider ID; display names and email addresses cannot prove ownership.
export const createGithubUser = internalMutation({
  args: { method: v.object({ name: v.literal('github'), profile: vGithubProfile }) },
  returns: v.id('users'),
  handler: async (ctx, { method }) => {
    const previous = await ctx.db.query('authAccounts')
      .withIndex('providerAndAccountId', q => q.eq('provider', 'github').eq('providerAccountId', method.profile.id)).unique()
    if (previous) {
      if (!await ctx.db.get(previous.userId)) throw new Error('Existing account needs recovery.')
      return previous.userId
    }
    return await ctx.db.insert('users', {})
  },
})
