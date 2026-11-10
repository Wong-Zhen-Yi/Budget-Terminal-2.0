import { convexAuth } from '@convex-dev/auth/server'
import GitHub from '@auth/core/providers/github'
import { desktopOAuthRedirect } from '../electron/shared/cloudOAuth'
import type { MutationCtx } from './_generated/server'
import { takeAuthLimit } from './authLimits'

export const { auth, signIn, signOut, store, isAuthenticated } = convexAuth({
  signIn: { maxFailedAttempsPerHour: 10 },
  callbacks: {
    redirect: async ({ redirectTo }) => desktopOAuthRedirect(redirectTo),
    beforeSessionCreation: async (ctx, { userId }) => {
      const state = await (ctx as MutationCtx).db.query('syncAccounts').withIndex('by_user', q => q.eq('userId', userId)).unique()
      if (state?.deleted) throw Error('This account is being deleted. Local data is safe.')
      if (!await takeAuthLimit(ctx, `session:${userId}`, 30, 3_600_000)) throw Error('Too many sign-ins. Try again later.')
    },
  },
  providers: [GitHub],
})
