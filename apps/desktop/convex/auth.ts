import { convexAuth } from '@convex-dev/auth/server'
import { Email } from '@convex-dev/auth/providers/Email'
import GitHub from '@auth/core/providers/github'
import { desktopOAuthRedirect } from '../electron/shared/cloudOAuth'
import { digest } from '../electron/shared/syncRecords'
import { makeFunctionReference } from 'convex/server'
import type { ActionCtx, MutationCtx } from './_generated/server'
import { takeAuthLimit } from './authLimits'

const emailLimit = makeFunctionReference<'mutation', { identifierHash: string }, boolean>('authLimits:email')

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
  providers: [GitHub, Email({
    id: 'email',
    maxAge: 15 * 60,
    generateVerificationToken: async () => {
      const bytes = crypto.getRandomValues(new Uint8Array(8))
      return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('').toUpperCase()
    },
    sendVerificationRequest: async ({ identifier, token }, ctx?: ActionCtx) => {
      if (!ctx || !await ctx.runMutation(emailLimit, { identifierHash: digest(identifier.trim().toLowerCase()) })) {
        throw Error('Too many sign-in emails. Try again in an hour.')
      }
      const key = process.env.AUTH_RESEND_KEY
      const from = process.env.AUTH_EMAIL_FROM
      if (!key || !from) throw new Error('Configure AUTH_RESEND_KEY and AUTH_EMAIL_FROM in Convex before signing in.')
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ from, to: identifier, subject: 'Budget Terminal sign-in code',
          text: `Your Budget Terminal sign-in code is ${token}. It expires in 15 minutes.` }),
      })
      if (!response.ok) throw new Error('Unable to send sign-in code. Check the email provider configuration.')
    },
  })],
})
